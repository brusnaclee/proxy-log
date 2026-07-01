import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import * as zlib from 'zlib';
import { db } from '../db/index.js';
import {
	adminConfig,
	allowedDevices,
	allowedIdes,
	apiKeys,
	chatSessions,
	devices,
	modelLimits,
	modelMonitor,
	providers,
	requestLogs,
} from '../db/schema.js';
import {
	convertResponseToOpenAI,
	convertStreamEvent,
	createStreamState,
	resolveAnthropicUpstreamUrl,
	buildAnthropicUpstreamHeaders,
	prepareAnthropicUpstreamBody,
} from '../utils/anthropic-adapter.js';
import {
	buildCachedRoundTripResponse,
	buildYouComStreamChunks,
	convertRequestToYouCom,
	convertResponseToYouComOpenAI,
} from '../utils/youcom-adapter.js';
import { apiKeyCache, configCache } from '../utils/cache.js';
import { calculateEstimatedCost } from '../utils/cost-calculator.js';
import {
	BILLABLE_LOG_SQL,
	turnCompletionTokensSql,
	turnPromptTokensSql,
	turnTotalTokensSql,
} from '../utils/counting.js';
import {
	generateApiKey,
	generateTrialApiKey,
	generateFingerprint,
	generateSessionId,
	getKeyPrefix,
	sha256,
} from '../utils/crypto.js';
import {
	detectIde,
	detectIdeFromContent,
	estimateTokens,
	getClientIp,
	normalizeIdeName,
} from '../utils/detect-ide.js';
import { logEmitter } from '../utils/event-emitter.js';
import {
	analyzeRequestMessages,
	detectToolCallsInResponse,
	getLastTurnTextForTokenEstimate,
	isTitleGenRequest,
	type MessageAnalysis,
} from '../utils/message-analyzer.js';
import {
	getModelCatalogResponse,
	getFilteredModelCatalogResponse,
	getNextApiKey,
	getOnlineModelsByLatency,
	getProviderForModel,
	isAutoCompatible,
	markKeyAsLimited,
	stripProviderPrefix,
} from '../utils/model-catalog.js';
import {
	checkModelPromptLimit,
	checkPromptLimit,
	findActiveOverride,
	findActiveOverrideInTx,
	getWindowResetMs,
	parseRateLimitWindow,
	normalizeModelForLimit,
} from '../utils/rate-limit.js';
import {
	detectOperatingSystem,
	extractContextInfo,
	extractToolNamesFromPayload,
	parseToolJson,
	toToolJson,
} from '../utils/telemetry.js';
import {
	consumeNonStreamingPayload,
	consumeStreamPayload,
	finalizeCompletion,
	makeAccumulator,
	resolveBillableTokens,
} from '../utils/token-extractor.js';
import {
	buildTrialModelsToTry,
	isRetryableUpstreamStatus,
} from '../utils/trial-routing.js';
import { isGpyProviderOrModel, resolveKeyDailyTokenLimit, resolveKeyPromptLimit } from '../utils/trial-config.js';
import { queueTrialNotification } from '../utils/trial-notify.js';

const proxy = new Hono();

async function notifyTrialLimitIfNeeded(
	keyRecord: { id: number; isTrial: boolean },
	message: string,
): Promise<void> {
	if (!keyRecord.isTrial) return;
	try {
		await queueTrialNotification(keyRecord.id, 'limit_reached', { message });
	} catch (err) {
		console.error('[trial] Failed to queue limit notification:', err);
	}
}

/** Trial keys count raw upstream tokens; regular keys use INPUT/OUTPUT_TOKEN_MULTIPLIER env. */
function tokenCountOpts(keyRecord: { isTrial: boolean }) {
	return keyRecord.isTrial ? { isTrial: true as const } : undefined;
}

type ContextEvent = 'new_session' | 'append' | 'compact' | 'switch';

// In-memory cache of the last user message hash per session.
const sessionHashCache = new Map<string, string>();

// In-memory cache of the current turn ID per session.
// When isNewPrompt=true, generate a new turn_id and store it here.
// For tool followups, reuse the same turn_id.
const turnIdCache = new Map<string, string>();

// Per-device mutex to serialize session resolution.
// Without this, concurrent requests from the same device can both read "no session"
// and each create their own session, causing duplicates and miscounts.
const deviceLocks = new Map<string, Promise<void>>();
async function withDeviceLock<T>(
	deviceKey: string,
	fn: () => Promise<T>,
): Promise<T> {
	// Wait for any existing lock on this device to release
	while (deviceLocks.has(deviceKey)) {
		await deviceLocks.get(deviceKey);
	}
	// Create our lock
	let resolve: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	deviceLocks.set(deviceKey, promise);
	try {
		return await fn();
	} finally {
		deviceLocks.delete(deviceKey);
		resolve!();
	}
}

/**
 * Derive a human-readable session name from the request body.
 *
 * Strategy (in priority order):
 * 1. First non-empty user message content (what the user actually typed).
 *    This mirrors what most IDE chat panels show as the conversation title.
 * 2. System message snippet (fallback when there's no user message yet,
 *    e.g. a sub-agent that only has a system prompt).
 * 3. requestPreview already extracted by telemetry (last resort).
 *
 * The name is trimmed to Γëñ72 chars so it fits in the UI comfortably.
 */
function deriveSessionName(requestBody: any, requestPreview: string): string {
	const MAX = 72;

	function truncate(s: string): string {
		const cleaned = s.replace(/\s+/g, ' ').trim();
		if (!cleaned) return '';
		return cleaned.length > MAX ? cleaned.slice(0, MAX - 1) + 'ΓÇª' : cleaned;
	}

	function extractText(value: any): string {
		if (!value) return '';
		if (typeof value === 'string') return value;
		if (Array.isArray(value)) {
			return value.map(extractText).filter(Boolean).join(' ');
		}
		if (typeof value === 'object') {
			return (
				extractText(value.text) ||
				extractText(value.content) ||
				extractText(value.input_text) ||
				''
			);
		}
		return '';
	}

	if (Array.isArray(requestBody?.messages)) {
		// Priority 1: first user message
		const firstUser = requestBody.messages.find(
			(m: any) => String(m?.role || '').toLowerCase() === 'user',
		);
		if (firstUser) {
			const text = truncate(
				extractText(firstUser?.content ?? firstUser?.text ?? firstUser),
			);
			if (text) return text;
		}

		// Priority 2: system message snippet
		const sys = requestBody.messages.find(
			(m: any) => String(m?.role || '').toLowerCase() === 'system',
		);
		if (sys) {
			const text = truncate(extractText(sys?.content ?? sys?.text ?? sys));
			if (text) return text;
		}
	}

	// Priority 3: requestPreview (already built by telemetry)
	if (requestPreview) {
		const text = truncate(requestPreview);
		if (text) return text;
	}

	return 'Untitled Chat';
}

const SESSION_GAP_MS = 45 * 60 * 1000;
const COMPACT_DROP_THRESHOLD = 80;
// Minimum time gap (ms) to consider a request as a new user prompt rather than
// an agent/sub-agent follow-up.  Sub-agents and tool calls typically fire within
// a few seconds, while a human typing a new prompt takes at least 10-15 seconds.
const NEW_PROMPT_MIN_GAP_MS = 10 * 1000; // 10 seconds
// For context switches (sub-agent exploration), require a larger gap to count as
// a genuine new user prompt.
const SWITCH_PROMPT_MIN_GAP_MS = 60 * 1000; // 60 seconds
const MAX_LOG_WRITE_QUEUE_SIZE = 20000;

/** Strip a `gpy/<upstream>/` prefix and return the bare model id used by the monitor table. */
function stripGpyPrefix(modelId: string): string {
  const lower = String(modelId || "").toLowerCase();
  if (!lower.startsWith("gpy/")) return lower;
  const parts = lower.split("/");
  return parts.slice(2).join("/");
}

/** Lookup `gpy/*` model ids whose latest monitor check within `windowMs` is offline / non-200. */
async function getRecentlyOfflineGpyModelIds(excludeModel: string, windowMs: number): Promise<Set<string>> {
  try {
    const since = new Date(Date.now() - windowMs);
    const rows = await db
      .select({ modelId: modelMonitor.modelId, isOnline: modelMonitor.isOnline, httpStatus: modelMonitor.httpStatus, checkedAt: modelMonitor.checkedAt })
      .from(modelMonitor)
      .where(gt(modelMonitor.checkedAt, since))
      .orderBy(desc(modelMonitor.checkedAt))
      .limit(500);
    const latestPerModel = new Map<string, { isOnline: boolean; httpStatus: number }>();
    for (const r of rows) {
      if (!latestPerModel.has(r.modelId)) {
        latestPerModel.set(r.modelId, { isOnline: !!r.isOnline, httpStatus: r.httpStatus || 0 });
      }
    }
    const offline = new Set<string>();
    const excludeBare = stripGpyPrefix(excludeModel);
    for (const [id, status] of latestPerModel.entries()) {
      if (id === excludeBare) continue;
      if (!status.isOnline || status.httpStatus === 0 || (status.httpStatus >= 500 && status.httpStatus < 600)) {
        offline.add(id);
      }
    }
    return offline;
  } catch {
    return new Set();
  }
}
const UPSTREAM_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour to support long reasoning models
const UPSTREAM_MAX_ATTEMPTS = 30;
const UPSTREAM_RETRY_BACKOFF_MS = 1000;

const logWriteQueue: Array<(tx: any) => Promise<void>> = [];
let logWriteRunning = false;
let droppedLogWrites = 0;

function enqueueLogWrite(task: (tx: any) => Promise<void>) {
	if (logWriteQueue.length >= MAX_LOG_WRITE_QUEUE_SIZE) {
		logWriteQueue.shift();
		droppedLogWrites += 1;
		if (droppedLogWrites % 100 === 1) {
			console.warn(
				`[proxy-log-writer] queue overflow, dropped jobs: ${droppedLogWrites}`,
			);
		}
	}

	logWriteQueue.push(task);
	if (!logWriteRunning) {
		void drainLogWriteQueue();
	}
}

async function drainLogWriteQueue() {
	if (logWriteRunning) return;
	logWriteRunning = true;

	while (logWriteQueue.length > 0) {
		// Process in batches of up to 500 tasks
		const batch = logWriteQueue.splice(0, 500);
		try {
			// Use a transaction for bulk insert/update to prevent SQLite locking and high CPU usage
			await db.transaction(async (tx) => {
				for (const task of batch) {
					await task(tx);
				}
			});
		} catch (error) {
			console.error(
				'[proxy-log-writer] batch transaction failed, falling back to sequential:',
				error,
			);
			for (const task of batch) {
				try {
					await task(db);
				} catch (err) {
					console.error(
						'[proxy-log-writer] failed to write individual log:',
						err,
					);
				}
			}
		}
	}

	logWriteRunning = false;
}

function parseDbDate(value: string | Date | null | undefined): number {
	if (!value) return 0;
	if (value instanceof Date) return value.getTime();
	const str = String(value);
	const normalized = str.includes('T') ? str : `${str.replace(' ', 'T')}Z`;
	const parsed = Date.parse(normalized);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(code: number): boolean {
	return (
		code === 401 ||
		code === 429 ||
		code === 500 ||
		code === 502 ||
		code === 503 ||
		code === 504 ||
		code === 524
	);
}

function isRetryableFetchError(error: any): boolean {
	const message = String(error?.message || '').toLowerCase();
	return (
		message.includes('fetch failed') ||
		message.includes('timeout') ||
		message.includes('network') ||
		message.includes('econnreset') ||
		message.includes('econnrefused')
	);
}

// Per-attempt timeout for non-streaming requests. 20s is enough for healthy
// upstreams; 1h is reserved for first-attempt streaming (long reasoning).
const RETRY_ATTEMPT_TIMEOUT_MS = 45_000;

async function fetchUpstreamWithRetry(
	url: string,
	init: RequestInit,
	isStreaming: boolean,
	clientSignal?: AbortSignal,
): Promise<Response> {
	let lastError: any = null;

	for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt++) {
		try {
			// Combine client abort signal with timeout
			const controller = new AbortController();
			// Streaming gets full hour; non-streaming retry attempts get short
			// timeout to fail fast on transient upstreams (avoid 10x wait).
			const timeoutMs = isStreaming && attempt === 1 ? UPSTREAM_TIMEOUT_MS : RETRY_ATTEMPT_TIMEOUT_MS;
			const timeoutId = setTimeout(
				() => controller.abort(new Error('Timeout')),
				timeoutMs,
			);

			const abortHandler = () => {
				controller.abort(
					clientSignal?.reason || new Error('Client disconnected'),
				);
			};

			if (clientSignal) {
				if (clientSignal.aborted) {
					throw new Error('Client already disconnected');
				}
				clientSignal.addEventListener('abort', abortHandler);
			}

			const response = await fetch(url, {
				...init,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);
			if (clientSignal) {
				clientSignal.removeEventListener('abort', abortHandler);
			}

			if (
				!isStreaming &&
				attempt < UPSTREAM_MAX_ATTEMPTS &&
				isRetryableStatus(response.status)
			) {
				try {
					await response.body?.cancel();
				} catch {}
				await sleep(UPSTREAM_RETRY_BACKOFF_MS * attempt);
				continue;
			}

			return response;
		} catch (error: any) {
			lastError = error;
			if (attempt < UPSTREAM_MAX_ATTEMPTS && isRetryableFetchError(error)) {
				await sleep(UPSTREAM_RETRY_BACKOFF_MS * attempt);
				continue;
			}
			throw error;
		}
	}

	throw lastError || new Error('Upstream request failed');
}

/**
 * Fetch upstream with API key rotation and retry-on-429 logic.
 * If the response is 429 (rate limited), marks the key as limited and retries with the next available key.
 * Returns { response, apiKeyId } so callers know which key was used.
 */
async function fetchWithKeyRotation(
	providerId: number,
	url: string,
	initFn: (apiKey: string) => RequestInit,
	isStreaming: boolean,
	clientSignal?: AbortSignal,
): Promise<{ response: Response; keyId: number; apiKey: string }> {
	const MAX_KEY_ATTEMPTS = 10; // don't loop forever
	const triedKeyIds = new Set<number>();

	for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
		const keyResult = await getNextApiKey(providerId);
		if (!keyResult) {
			throw new Error(
				'All API keys for this provider are rate-limited. Reset keys in the dashboard.',
			);
		}

		if (triedKeyIds.has(keyResult.keyId)) {
			// Already tried this key (shouldn't happen with proper filtering, but safety)
			throw new Error('No new API keys available. All have been tried.');
		}
		triedKeyIds.add(keyResult.keyId);

		const init = initFn(keyResult.apiKey);
		const response = await fetchUpstreamWithRetry(
			url,
			init,
			isStreaming,
			clientSignal,
		);

		if (response.status === 401) {
			// Invalid key — mark and try the next one.
			console.warn(
				`[key-rotation] Key ${keyResult.keyId} for provider ${providerId} returned 401, marking as invalid`,
			);
			await markKeyAsLimited(keyResult.keyId);
			try {
				await response.body?.cancel();
			} catch {}
			continue;
		}

		if (response.status === 429) {
			// Rate limited — try next key if available, but do not permanently
			// disable the key (quota may reset shortly).
			console.warn(
				`[key-rotation] Key ${keyResult.keyId} for provider ${providerId} returned 429, trying next key`,
			);
			try {
				await response.body?.cancel();
			} catch {}
			continue;
		}

		return { response, keyId: keyResult.keyId, apiKey: keyResult.apiKey };
	}

	throw new Error('All API keys exhausted after rate-limit retries.');
}

async function createChatSession(params: {
	apiKeyId: number;
	apiKeyName: string;
	ipAddress: string;
	deviceFingerprint: string;
	ideDetected: string;
	provider: string;
	model: string;
	contextFingerprint: string;
	contextTokensBefore: number;
	requestPreview: string;
	isUserPrompt?: boolean; // false for sub-agent spawned sessions
	messageAnalysis?: MessageAnalysis;
	requestBody?: any; // raw request body for session name extraction
}) {
	const sessionId = `chat_${generateSessionId().slice(0, 24)}`;
	const now = new Date();
	const sessionName = deriveSessionName(
		params.requestBody,
		params.requestPreview,
	);
	await db.insert(chatSessions).values({
		sessionId,
		apiKeyId: params.apiKeyId,
		apiKeyName: params.apiKeyName,
		ipAddress: params.ipAddress,
		deviceFingerprint: params.deviceFingerprint,
		ideDetected: params.ideDetected,
		provider: params.provider,
		model: params.model,
		sessionName,
		contextFingerprint: params.contextFingerprint || null,
		lastContextTokens: params.contextTokensBefore,
		lastRequestPreview: params.requestPreview || null,
		firstSeenAt: now,
		lastSeenAt: now,
		requestCount: 0,
		promptCount: 0,
		totalTokens: 0,
		compactCount: 0,
		switchCount: 0,
		lastUserMessageHash: params.messageAnalysis?.messageHash || null,
		lastMessageRole: params.messageAnalysis?.messageRole || null,
		lastToolCallsActive: false,
	});
	return sessionId;
}

async function resolveChatSession(params: {
	apiKeyId: number;
	apiKeyName: string;
	ipAddress: string;
	deviceFingerprint: string;
	ideDetected: string;
	provider: string;
	model: string;
	contextFingerprint: string;
	contextTokensBefore: number;
	requestPreview: string;
	messageAnalysis: MessageAnalysis;
	requestBody?: any;
	requestToolCount?: number;
}): Promise<{
	sessionId: string;
	contextEvent: ContextEvent;
	contextDeltaTokens: number;
	gapMs: number;
	isNewUserPrompt: boolean;
}> {
	// ΓöÇΓöÇΓöÇ Find the most recent session for this device ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	const latest = await db
		.select()
		.from(chatSessions)
		.where(
			and(
				eq(chatSessions.apiKeyId, params.apiKeyId),
				eq(chatSessions.deviceFingerprint, params.deviceFingerprint),
			),
		)
		.orderBy(desc(chatSessions.lastSeenAt))
		.limit(1)
		.then((r) => r[0]);

	// Also look for any very recent session from this device (within sub-agent window)
	// to handle async race conditions where row N+1 arrives before row N's session is committed
	const recentCutoff = new Date(Date.now() - SWITCH_PROMPT_MIN_GAP_MS);
	const veryRecent = await db
		.select()
		.from(chatSessions)
		.where(
			and(
				eq(chatSessions.apiKeyId, params.apiKeyId),
				eq(chatSessions.deviceFingerprint, params.deviceFingerprint),
				sql`last_seen_at >= ${recentCutoff}`,
			),
		)
		.orderBy(desc(chatSessions.lastSeenAt))
		.limit(1)
		.then((r) => r[0]);

	// ΓöÇΓöÇΓöÇ No session yet ΓåÆ create first one ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	if (!latest) {
		const isNewUserPrompt = params.messageAnalysis.hasUserMessage;
		const sessionId = await createChatSession({
			...params,
			isUserPrompt: isNewUserPrompt,
			messageAnalysis: params.messageAnalysis,
		});
		return {
			sessionId,
			contextEvent: 'new_session',
			contextDeltaTokens: params.contextTokensBefore || 0,
			gapMs: Infinity,
			isNewUserPrompt,
		};
	}

	const gapMs = Date.now() - parseDbDate(latest.lastSeenAt);

	// Sub-agent race condition: latest is stale but there's a very recent different session
	if (
		gapMs > SESSION_GAP_MS &&
		veryRecent &&
		veryRecent.sessionId !== latest.sessionId
	) {
		const veryRecentGap = Date.now() - parseDbDate(veryRecent.lastSeenAt);
		return {
			sessionId: veryRecent.sessionId,
			contextEvent: 'switch',
			contextDeltaTokens: params.contextTokensBefore || 0,
			gapMs: veryRecentGap,
			isNewUserPrompt: false,
		};
	}

	// ΓöÇΓöÇΓöÇ Gap > 45 min ΓåÆ definitely a new session ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	if (gapMs > SESSION_GAP_MS) {
		const isNewUserPrompt = params.messageAnalysis.hasUserMessage;
		const sessionId = await createChatSession({
			...params,
			isUserPrompt: isNewUserPrompt,
			messageAnalysis: params.messageAnalysis,
		});
		return {
			sessionId,
			contextEvent: 'new_session',
			contextDeltaTokens: params.contextTokensBefore || 0,
			gapMs,
			isNewUserPrompt,
		};
	}

	// ΓöÇΓöÇΓöÇ Within session window: determine new-chat vs continuation ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	//
	// Reliable signals for detecting new chat:
	//   1. Context size shrink (history wiped) + hash changed ΓåÆ new chat
	//   2. No assistant messages in context (fresh chat with only system + 1 user msg) + hash changed ΓåÆ new chat
	//   3. Internal IDE requests (title gen) ΓåÆ never a new prompt, never a new session
	//   4. Same hash, short gap ΓåÆ IDE retry / sub-agent ΓåÆ same session

	const prevTokens = latest.lastContextTokens || 0;
	const incomingTokens = params.contextTokensBefore;

	// Use in-memory hash cache (single source of truth, immune to async DB lag).
	// Fall back to DB value only if cache is empty (e.g. server restart).
	const cachedHash =
		sessionHashCache.get(latest.sessionId) || latest.lastUserMessageHash || '';
	const hashChanged = !!(
		params.messageAnalysis.messageHash &&
		params.messageAnalysis.messageHash !== cachedHash
	);

	// ΓöÇΓöÇ Detect "New Chat" button pressed ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	// Method 1: Context size dropped dramatically (history wiped)
	const contextResetToZero = incomingTokens <= 0 && prevTokens > 0;
	const contextShrankMassively =
		prevTokens > 200 &&
		incomingTokens < prevTokens * 0.4 &&
		incomingTokens <= 200;

	if ((contextResetToZero || contextShrankMassively) && hashChanged) {
		const isNewUserPrompt = params.messageAnalysis.hasUserMessage;
		const sessionId = await createChatSession({
			...params,
			isUserPrompt: isNewUserPrompt,
			messageAnalysis: params.messageAnalysis,
		});
		return {
			sessionId,
			contextEvent: 'new_session',
			contextDeltaTokens: params.contextTokensBefore || 0,
			gapMs,
			isNewUserPrompt,
		};
	}

	// Method 2: No assistant messages in context = fresh chat (user opened new chat,
	// typed something new). A continuation always has at least 1 assistant reply in history.
	// This catches model-switch new chats where context size stays large (big system prompt).
	if (
		hashChanged &&
		params.messageAnalysis.assistantMessageCount === 0 &&
		params.messageAnalysis.userMessageCount <= 2 && // system + 1-2 user messages
		prevTokens > 0 // had a previous session (not first-ever request)
	) {
		const isNewUserPrompt = params.messageAnalysis.hasUserMessage;
		const sessionId = await createChatSession({
			...params,
			isUserPrompt: isNewUserPrompt,
			messageAnalysis: params.messageAnalysis,
		});
		return {
			sessionId,
			contextEvent: 'new_session',
			contextDeltaTokens: params.contextTokensBefore || 0,
			gapMs,
			isNewUserPrompt,
		};
	}

	// ΓöÇΓöÇ Same session continuation (model change, context growth, or sub-agent) ΓöÇΓöÇ
	const delta = incomingTokens - prevTokens;
	const contextEvent: ContextEvent =
		delta <= -COMPACT_DROP_THRESHOLD ? 'compact' : 'append';

	// ΓöÇΓöÇΓöÇ Determine if this is a new user prompt ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	//
	// The ONLY question: did the user type a new message that deserves to be counted?
	//
	// Rules (in order):
	//   1. Not a user message ΓåÆ never counted
	//   2. Hash changed AND has assistant history in context ΓåÆ ALWAYS counted
	//      (user typed something new in an existing conversation)
	//   3. Hash changed AND no assistant history ΓåÆ counted ONLY if context has tools
	//      (IDE sends 2 requests: first compact without tools/history, then full.
	//       The full one has tools. The compact one is just IDE setup, skip it.)
	//   4. Hash same AND has assistant history ΓåÆ not counted (IDE retry/sub-agent)
	//   5. Hash same AND no assistant history AND no tools ΓåÆ not counted (IDE compact retry)
	//
	// This is simple and doesn't depend on gap timing or lastToolCallsActive (which
	// suffers from async write race conditions).
	let isNewUserPrompt = false;
	const toolCount = params.requestToolCount ?? 0;
	const role = params.messageAnalysis.messageRole;
	const isToolChainFollowup = params.messageAnalysis.isToolChainFollowup === true;

	if (role && role !== 'user') {
		isNewUserPrompt = false;
	} else if (isToolChainFollowup) {
		// OpenCode-style: the last "user" message is a follow-up appended
		// to an ongoing tool-execution chain. This is NOT a new prompt.
		isNewUserPrompt = false;
	} else if (params.messageAnalysis.hasUserMessage && hashChanged) {
		if (params.messageAnalysis.isRawFormat) {
			isNewUserPrompt = true; // Always count new raw format prompts
		} else if (params.messageAnalysis.assistantMessageCount > 0) {
			isNewUserPrompt = true;
		} else {
			isNewUserPrompt = toolCount > 0;
		}
	} else if (
		!hashChanged &&
		params.messageAnalysis.hasUserMessage &&
		gapMs >= SWITCH_PROMPT_MIN_GAP_MS
	) {
		isNewUserPrompt = true;
	}

	return {
		sessionId: latest.sessionId,
		contextEvent,
		contextDeltaTokens: delta,
		gapMs,
		isNewUserPrompt,
	};
}

async function updateSessionAfterRequest(
	tx: any,
	params: {
		sessionId: string;
		ipAddress: string;
		ideDetected: string;
		provider: string;
		model: string;
		contextFingerprint: string;
		contextTokensBefore: number;
		requestPreview: string;
		totalTokens: number;
		estimatedCost: number;
		contextEvent: ContextEvent;
		isNewPrompt: boolean;
		messageAnalysis: MessageAnalysis;
		hasActualToolCalls: boolean;
	},
) {
	// NOTE: Tracking fields (lastSeenAt, lastUserMessageHash, lastMessageRole,
	// lastContextTokens, contextFingerprint, model) are already updated synchronously
	// right after resolveChatSession() to prevent race conditions. Here we only update
	// stats (token counts, cost, request counts) and fields that depend on the upstream
	// response (lastToolCallsActive, lastRequestPreview).
	const updates: Record<string, any> = {
		ipAddress: params.ipAddress,
		ideDetected: params.ideDetected,
		provider: params.provider,
		lastRequestPreview: params.requestPreview || null,
		lastToolCallsActive: params.hasActualToolCalls,
	};

	if (params.isNewPrompt) {
		updates.totalTokens = sql`${chatSessions.totalTokens} + ${Math.max(params.totalTokens || 0, 0)}`;
		updates.estimatedCost = sql`${chatSessions.estimatedCost} + ${Math.max(params.estimatedCost || 0, 0)}`;
		updates.requestCount = sql`${chatSessions.requestCount} + 1`;
		updates.promptCount = sql`${chatSessions.promptCount} + 1`;
	}

	if (params.contextEvent === 'compact') {
		updates.compactCount = sql`${chatSessions.compactCount} + 1`;
	}

	if (params.contextEvent === 'switch') {
		updates.switchCount = sql`${chatSessions.switchCount} + 1`;
	}

	if (params.messageAnalysis.turnKind === 'tool_followup') {
		updates.consecutiveToolFollowups = sql`${chatSessions.consecutiveToolFollowups} + 1`;
	} else if (params.messageAnalysis.turnKind === 'user_prompt') {
		updates.consecutiveToolFollowups = 0;
	}

	await tx
		.update(chatSessions)
		.set(updates)
		.where(eq(chatSessions.sessionId, params.sessionId));
}

/**
 * Catch-all proxy handler for /v1/*
 * Forwards requests to the configured upstream AI API endpoint
 */
proxy.all('/*', async (c) => {
	const startTime = Date.now();
	const path = c.req.path; // e.g., /v1/chat/completions
	const normalizedPath = path.replace(/\/+$/, '') || '/';

	// Anthropic Messages endpoint detection — path-based OR body-shape-based.
	// Clients like Claude Code send POST /v1/messages (strict Anthropic format).
	// We translate to OpenAI Chat Completions internally and back to Anthropic on response.
	const {
		isAnthropicMessagesPath,
		convertAnthropicToOpenAI,
		convertOpenAIToAnthropicResponse,
		looksLikeAnthropicMessages,
		convertOpenAIChunkToAnthropicEvents,
		flushAnthropicStream,
		createAnthropicStreamState,
	} = await import("../utils/anthropic-adapter.js");
	const anthropicByPath = isAnthropicMessagesPath(path);

	// Public model discovery endpoints from local cache.
	// If a Bearer token is present, filter by the key's isTrial flag so trial
	// users only see gpy/* models (their allowlist). Without auth, return full
	// catalog (browsing in IDEs without API key still works).
	if (
		(c.req.method === 'GET' || c.req.method === 'HEAD') &&
		(normalizedPath === '/v1' || normalizedPath === '/v1/models')
	) {
		const head = c.req.method === 'HEAD';
		if (head) {
			return new Response(null, {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const authH = c.req.header('Authorization');
		let isTrial: boolean | undefined;
		if (authH && authH.startsWith('Bearer ')) {
			const token = authH.replace(/^Bearer\s+/i, '').trim();
			if (token) {
				let rec = await db
					.select({ id: apiKeys.id, isTrial: apiKeys.isTrial, isActive: apiKeys.isActive })
					.from(apiKeys)
					.where(eq(apiKeys.key, token))
					.then((r) => r[0]);
				if (!rec) {
					rec = await db
						.select({ id: apiKeys.id, isTrial: apiKeys.isTrial, isActive: apiKeys.isActive })
						.from(apiKeys)
						.where(eq(apiKeys.keyHash, sha256(token)))
						.then((r) => r[0]);
				}
				if (rec && rec.isActive) isTrial = !!rec.isTrial;
			}
		}

		const catalog = await getFilteredModelCatalogResponse({ isTrial });
		return c.json(catalog);
	}

	// ΓöÇΓöÇΓöÇ 1. Extract API Key ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	const authHeader = c.req.header('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json(
			{
				error: {
					message:
						'Missing or invalid Authorization header. Use: Bearer <api_key>',
					type: 'auth_error',
				},
			},
			401,
		);
	}
	const clientKey = authHeader.replace(/^Bearer\s+/i, '').trim();

	// ΓöÇΓöÇΓöÇ 2. Validate API Key ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	let keyRecord = await apiKeyCache.getOrFetch(`key:${clientKey}`, async () => {
		let record = await db
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.key, clientKey))
			.then((r) => r[0]);

		if (!record) {
			record = await db
				.select()
				.from(apiKeys)
				.where(eq(apiKeys.keyHash, sha256(clientKey)))
				.then((r) => r[0]);
		}
		return record || null;
	});

	if (!keyRecord) {
		const keyPrefix = clientKey.slice(0, 12);
		console.warn(`[auth] API key lookup failed for prefix: ${keyPrefix}`);
		return c.json(
			{ error: { message: 'Invalid API key.', type: 'auth_error' } },
			401,
		);
	}

	if (!keyRecord.isActive) {
		return c.json(
			{ error: { message: 'API key is disabled.', type: 'auth_error' } },
			403,
		);
	}

	// ΓöÇΓöÇΓöÇ 3. Device Fingerprinting & IDE Detection ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	const userAgent = c.req.header('User-Agent') || '';
	const platformHintRaw = c.req.header('sec-ch-ua-platform') || '';
	const deviceName =
		c.req.header('x-device-name') || c.req.header('x-machine-name') || '';
	const clientName =
		c.req.header('x-client-name') || c.req.header('x-app-name') || '';
	const deviceId =
		c.req.header('x-device-id') ||
		c.req.header('device-id') ||
		c.req.header('x-machine-id') ||
		'';
	const clientIp = getClientIp(
		c.req.raw.headers,
		c.req.header('x-real-ip') || '127.0.0.1',
	);
	const fingerprint = generateFingerprint(clientIp, userAgent, deviceId);
	let ide = detectIde(userAgent);
	const platformHint = platformHintRaw + ' ' + deviceName;
	const osDetected = detectOperatingSystem(userAgent, platformHint);
	let normalizedIde = normalizeIdeName(ide);

	// ΓöÇΓöÇΓöÇ 4. Device Policy Check ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	const existingDevice = await db
		.select()
		.from(devices)
		.where(
			and(
				eq(devices.apiKeyId, keyRecord.id),
				eq(devices.fingerprint, fingerprint),
			),
		)
		.then((r) => r[0]);

	if (existingDevice?.isBlocked) {
		return c.json(
			{
				error: {
					message: 'This device has been blocked.',
					type: 'access_error',
				},
			},
			403,
		);
	}

	if (keyRecord.devicePolicy === 'allowlist') {
		const allowed = await db
			.select()
			.from(allowedDevices)
			.where(
				and(
					eq(allowedDevices.apiKeyId, keyRecord.id),
					eq(allowedDevices.fingerprint, fingerprint),
					eq(allowedDevices.listType, 'allow'),
				),
			)
			.then((r) => r[0]);
		if (!allowed) {
			return c.json(
				{
					error: { message: 'Device not in allowlist.', type: 'access_error' },
				},
				403,
			);
		}
	} else if (keyRecord.devicePolicy === 'blacklist') {
		const blocked = await db
			.select()
			.from(allowedDevices)
			.where(
				and(
					eq(allowedDevices.apiKeyId, keyRecord.id),
					eq(allowedDevices.fingerprint, fingerprint),
					eq(allowedDevices.listType, 'block'),
				),
			)
			.then((r) => r[0]);
		if (blocked) {
			return c.json(
				{ error: { message: 'Device is blacklisted.', type: 'access_error' } },
				403,
			);
		}
	}

	// ΓöÇΓöÇΓöÇ 4b. IDE Policy Check ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	if (keyRecord.idePolicy === 'allowlist') {
		const allowedIde = await db
			.select()
			.from(allowedIdes)
			.where(
				and(
					eq(allowedIdes.apiKeyId, keyRecord.id),
					eq(allowedIdes.ideName, normalizedIde),
					eq(allowedIdes.listType, 'allow'),
				),
			)
			.then((r) => r[0]);
		if (!allowedIde) {
			return c.json(
				{
					error: {
						message: `IDE '${ide}' not in allowlist.`,
						type: 'access_error',
					},
				},
				403,
			);
		}
	} else if (keyRecord.idePolicy === 'blacklist') {
		const blockedIde = await db
			.select()
			.from(allowedIdes)
			.where(
				and(
					eq(allowedIdes.apiKeyId, keyRecord.id),
					eq(allowedIdes.ideName, normalizedIde),
					eq(allowedIdes.listType, 'block'),
				),
			)
			.then((r) => r[0]);
		if (blockedIde) {
			return c.json(
				{
					error: {
						message: `IDE '${ide}' is blacklisted.`,
						type: 'access_error',
					},
				},
				403,
			);
		}
	}

	// ΓöÇΓöÇΓöÇ 5. IP Policy Check ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	if (keyRecord.ipPolicy === 'allowlist') {
		const allowed = await db
			.select()
			.from(allowedDevices)
			.where(
				and(
					eq(allowedDevices.apiKeyId, keyRecord.id),
					eq(allowedDevices.ipAddress, clientIp),
					eq(allowedDevices.listType, 'allow'),
				),
			)
			.then((r) => r[0]);
		if (!allowed) {
			return c.json(
				{
					error: {
						message: 'IP address not in allowlist.',
						type: 'access_error',
					},
				},
				403,
			);
		}
	} else if (keyRecord.ipPolicy === 'blacklist') {
		const blocked = await db
			.select()
			.from(allowedDevices)
			.where(
				and(
					eq(allowedDevices.apiKeyId, keyRecord.id),
					eq(allowedDevices.ipAddress, clientIp),
					eq(allowedDevices.listType, 'block'),
				),
			)
			.then((r) => r[0]);
		if (blocked) {
			return c.json(
				{
					error: {
						message: 'IP address is blacklisted.',
						type: 'access_error',
					},
				},
				403,
			);
		}
	}

	// ΓöÇΓöÇΓöÇ 6. Max Devices Check ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	if (keyRecord.maxDevices && keyRecord.maxDevices > 0) {
		const deviceCount = await db
			.select({ count: sql<number>`count(*)` })
			.from(devices)
			.where(
				and(eq(devices.apiKeyId, keyRecord.id), eq(devices.isBlocked, false)),
			)
			.then((r) => r[0]);

		if (
			deviceCount &&
			deviceCount.count >= keyRecord.maxDevices &&
			!existingDevice
		) {
			if (keyRecord.provisionedBy === 'discord-bot' || keyRecord.isTrial || keyRecord.provisionedBy === 'trial-bot') {
				// Generate a fresh active key, remove old device, queue DM+thread notification
				const rotatedKey = keyRecord.isTrial ? generateTrialApiKey() : generateApiKey();
				const newKeyPrefix = getKeyPrefix(rotatedKey);

				// Remove all old devices for this key so the new device can register cleanly
				await db.delete(devices).where(eq(devices.apiKeyId, keyRecord.id));

				// Register the new device immediately so they don't have to hit the limit again
				await db.insert(devices).values({
					apiKeyId: keyRecord.id,
					fingerprint,
					ipAddress: clientIp,
					userAgentRaw: userAgent,
					osDetected,
					deviceName: deviceName || null,
					ideDetected: ide,
					requestCount: 0,
				});

				// Update the key to the new value (stays active)
				await db
					.update(apiKeys)
					.set({
						key: rotatedKey,
						keyPrefix: newKeyPrefix,
						keyHash: sha256(rotatedKey),
						isActive: true,
						updatedAt: new Date(),
					})
					.where(eq(apiKeys.id, keyRecord.id));

				// Store pending notification for bot to pick up and send
				const proxyEndpoint = `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || '3000'}`}/v1`;
				const notification = {
					type: keyRecord.isTrial ? 'trial_key_rotated' : 'new_device_detected',
					discordUserId: keyRecord.discordUserId,
					newKey: rotatedKey,
					endpoint: proxyEndpoint,
				};
				await db
					.update(apiKeys)
					.set({
						pendingNotification: JSON.stringify(notification),
					})
					.where(eq(apiKeys.id, keyRecord.id));

				return c.json(
					{
						error: {
							message: `Maximum device limit (${keyRecord.maxDevices}) reached. Your API key has been rotated automatically. Please check your Discord DMs for your new key.`,
							type: 'access_error',
							code: 'discord_new_device_key_rotated',
						},
					},
					403,
				);
			}

			return c.json(
				{
					error: {
						message: `Maximum device limit (${keyRecord.maxDevices}) reached.`,
						type: 'access_error',
					},
				},
				403,
			);
		}
	}

	// ΓöÇΓöÇΓöÇ 7. Fetch Config & Parse Request Body ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	const config = await configCache.getOrFetch('admin_config', () =>
		db
			.select()
			.from(adminConfig)
			.then((r) => r[0]),
	);
	if (!config) {
		return c.json(
			{
				error: {
					message:
						'Upstream API not configured. Please configure via admin dashboard.',
					type: 'server_error',
				},
			},
			503,
		);
	}

	let requestBody: any = null;
	let model = 'unknown';
	let contextTokensBefore = 0;
	let contextFingerprint = '';
	let requestPreview = '';
	let transcriptSnapshot = '';
	let requestToolNames: string[] = [];
	let estimatedContextLength = 0;
	const contentType = c.req.header('Content-Type') || '';
	let requestBodyBytes: Uint8Array | undefined;
	const canHaveBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';

	if (canHaveBody) {
		try {
			const rawBuffer = await c.req.raw.arrayBuffer();
			if (rawBuffer.byteLength > 0) {
				requestBodyBytes = new Uint8Array(rawBuffer);

				// Always decompress if Content-Encoding is set, regardless of content type.
				// We strip Content-Encoding from upstream headers, so we MUST decompress here
				// or the upstream receives binary garbage it cannot parse.
				const encoding = (
					c.req.header('Content-Encoding') || ''
				).toLowerCase();
				if (encoding) {
					try {
						if (encoding.includes('gzip')) {
							requestBodyBytes = zlib.gunzipSync(requestBodyBytes);
						} else if (encoding.includes('deflate')) {
							requestBodyBytes = zlib.inflateSync(requestBodyBytes);
						} else if (encoding.includes('br')) {
							requestBodyBytes = zlib.brotliDecompressSync(requestBodyBytes);
						}
					} catch (err) {
						// Decompression failed — keep original bytes and hope upstream can handle it
					}
				}

				const isProbablyJson = contentType
					.toLowerCase()
					.includes('application/json');
				const isTextLike = contentType.toLowerCase().startsWith('text/');

				if (isProbablyJson || isTextLike) {
					const bodyText = new TextDecoder().decode(requestBodyBytes);
					if (bodyText) {
						try {
							requestBody = JSON.parse(bodyText);
							// Re-encode to ensure clean JSON bytes for upstream
							requestBodyBytes = new TextEncoder().encode(JSON.stringify(requestBody));
						} catch {
							const normalizedBody = bodyText.replace(/\s+/g, ' ').trim();
							requestPreview = normalizedBody.slice(0, 220);
							transcriptSnapshot = normalizedBody.slice(0, 12000);
							contextTokensBefore = estimateTokens(normalizedBody);
							estimatedContextLength = contextTokensBefore;
						}
					}
				}
			}
		} catch {
			// Ignore body parse errors and continue to proxy request.
		}
	}

	if (requestBody) {		const contextInfo = extractContextInfo(requestBody);
		model = requestBody?.model || contextInfo.model || 'unknown';
		contextTokensBefore = contextInfo.contextTokensBefore;
		estimatedContextLength = contextInfo.contextTokensBefore;
		contextFingerprint = contextInfo.contextFingerprint;
		requestPreview = contextInfo.requestPreview;
		transcriptSnapshot = contextInfo.transcriptSnapshot;
		requestToolNames = contextInfo.requestToolNames;
	}

	// ─── 7a. Responses API Conversion (/v1/responses -> /v1/chat/completions) ───
	// Codex CLI and some clients use the OpenAI Responses API format.
	// Convert to Chat Completions format for upstream providers that don't support it.
	const isResponsesApi = normalizedPath === '/v1/responses';
	let forwardPath = path; // path to forward to upstream

	if (isResponsesApi && requestBody) {
		// Convert Responses API input to Chat Completions messages
		let messages: any[] = [];
		const input = requestBody.input;

		if (typeof input === 'string') {
			messages = [{ role: 'user', content: input }];
		} else if (Array.isArray(input)) {
			for (const item of input) {
				if (item.role && item.content) {
					// Standard message format
					messages.push({
						role: item.role,
						content:
							typeof item.content === 'string'
								? item.content
								: JSON.stringify(item.content),
					});
				} else if (item.type === 'message' && item.content) {
					// Responses API message block
					const textContent = Array.isArray(item.content)
						? item.content
								.filter(
									(c: any) =>
										c.type === 'output_text' || c.type === 'input_text',
								)
								.map((c: any) => c.text)
								.join('')
						: String(item.content);
					messages.push({ role: item.role || 'user', content: textContent });
				}
			}
		}

		// Build Chat Completions request body
		const chatBody: any = {
			model: requestBody.model,
			messages,
			stream: requestBody.stream ?? false,
		};
		if (requestBody.temperature !== undefined)
			chatBody.temperature = requestBody.temperature;
		if (requestBody.max_output_tokens !== undefined)
			chatBody.max_tokens = requestBody.max_output_tokens;
		if (requestBody.max_tokens !== undefined)
			chatBody.max_tokens = requestBody.max_tokens;
		if (requestBody.top_p !== undefined) chatBody.top_p = requestBody.top_p;
		if (Array.isArray(requestBody.tools)) {
			// Responses API uses flat tools: {name, description, parameters, strict}
			// Chat Completions needs nested: {type: "function", function: {...}}
			// (mimo and other strict upstreams reject flat shape with "`function` is not set")
			chatBody.tools = requestBody.tools.map((t: any) => {
				if (!t) return t;
				if (t.function && typeof t.function === "object") return t; // already nested
				return {
					type: "function",
					function: {
						name: t.name,
						description: t.description,
						parameters: t.parameters,
						strict: t.strict,
					},
				};
			});
		}
		if (requestBody.stop) chatBody.stop = requestBody.stop;

		requestBody = chatBody;
		// Re-encode body bytes with converted format
		const convertedBodyStr = JSON.stringify(chatBody);
		requestBodyBytes = new TextEncoder().encode(convertedBodyStr);

		// Change forward path to chat/completions
		forwardPath = path.replace('/v1/responses', '/v1/chat/completions');
	}

	// ─── 7c. Anthropic Messages -> OpenAI Chat Completions ─────────────────
	// Detect Anthropic format clients (Claude Code, Anthropic SDK) and translate.
	// Detection: path matches /v1/messages OR body shape is Anthropic (system string + max_tokens + messages array).
	let isAnthropicRequest = anthropicByPath;
	if (!isAnthropicRequest && requestBody && c.req.method === 'POST') {
		if (looksLikeAnthropicMessages(requestBody)) {
			isAnthropicRequest = true;
		}
	}
	if (isAnthropicRequest && requestBody) {
		try {
			const openaiBody = convertAnthropicToOpenAI(requestBody as any);
			requestBody = openaiBody as any;
			requestBodyBytes = new TextEncoder().encode(JSON.stringify(requestBody));
			forwardPath = '/v1/chat/completions';
			console.log(`[proxy] anthropic->openai translation for model=${(requestBody as any).model}`);
		} catch (err) {
			console.error('[proxy] anthropic translation failed:', (err as Error).message);
			return c.json({
				error: {
					type: "invalid_request_error",
					message: `Anthropic request translation failed: ${(err as Error).message}`,
				}
			}, 400);
		}
	}

	// ─── 7b. Content-based IDE fallback detection ──────────────────────────
	// When User-Agent is generic (e.g. "node"), try to identify the IDE from
	// the request body content (system prompt, tool names, transcript).
	if (ide === 'Unknown' && requestBody) {
		const contentIde = detectIdeFromContent(requestBody, transcriptSnapshot);
		if (contentIde) {
			ide = contentIde;
			normalizedIde = normalizeIdeName(ide);
		}
	}

	// ─── 8. Analyze Request Messages ───────────────────────────────────────────────
	const messageAnalysis = analyzeRequestMessages(requestBody);
	const fullLastUserTurnText = getLastTurnTextForTokenEstimate(requestBody);

	// ─── 9-pre-auto. Global Prompt Limit Check (all models, both auto & non-auto) ─
	// This runs BEFORE the auto-model handler so auto requests are also rate-limited.
	{
		const { limit: effectivePromptLimit, window: effectivePromptLimitWindow } =
			resolveKeyPromptLimit(keyRecord, config);

		if (effectivePromptLimit > 0) {
			const plCheck = await checkPromptLimit(
				keyRecord.id,
				effectivePromptLimit,
				effectivePromptLimitWindow,
			);
			if (!plCheck.allowed) {
				const windowMs = parseRateLimitWindow(effectivePromptLimitWindow);
				const resetMs = await getWindowResetMs(keyRecord.id, windowMs);
				const resetMins = Math.ceil(resetMs / 60000);
				const isKeyOverride = (keyRecord.promptLimit || 0) > 0;
				const trialTag = keyRecord.isTrial ? ' (trial)' : '';
				const limitMsg = `All model limit reached${isKeyOverride ? ' (key override)' : ''}${trialTag}: ${plCheck.used}/${effectivePromptLimit} prompts used in this ${effectivePromptLimitWindow} window. Resets in ~${resetMins} minute(s).`;
				await notifyTrialLimitIfNeeded(keyRecord, limitMsg);
				return c.json(
					{
						error: {
							message: limitMsg,
							type: 'rate_limit_error',
							code: 'prompt_limit_exceeded',
						},
					},
					429,
					{
						'x-prompt-limit': String(effectivePromptLimit),
						'x-prompt-remaining': '0',
						'x-prompt-used': String(plCheck.used),
						'x-prompt-reset-mins': String(resetMins),
					},
				);
			}
		}
	}

	// ─── 8-auto. Auto Model Handler ────────────────────────────────────────────────
	// Virtual "auto" model: try online models in order of lowest latency until one works.
	if (model === 'auto') {
		let onlineModels = await getOnlineModelsByLatency();
		onlineModels = onlineModels.filter((m) => isAutoCompatible(m.modelId));
		if (keyRecord.isTrial) {
			const gpyOnly = onlineModels.filter((m) => isGpyProviderOrModel(m.provider, m.modelId));
			if (gpyOnly.length > 0) onlineModels = gpyOnly;
		}

		if (onlineModels.length === 0) {
			return c.json(
				{
					error: {
						message: 'No compatible online models available for auto selection',
						type: 'model_offline',
					},
				},
				503,
			);
		}

		// Resolve session for auto model (so it appears in session history)
		const deviceLockKey = `${keyRecord.id}:${fingerprint}`;
		const autoSessionResult = await withDeviceLock(deviceLockKey, async () => {
			const sessionResult = await resolveChatSession({
				apiKeyId: keyRecord.id,
				apiKeyName: keyRecord.name,
				ipAddress: clientIp,
				deviceFingerprint: fingerprint,
				ideDetected: ide,
				provider: 'auto',
				model: 'auto',
				contextFingerprint,
				contextTokensBefore,
				requestPreview,
				messageAnalysis,
			});
			// Update tracking fields
			if (messageAnalysis.messageHash) {
				sessionHashCache.set(
					sessionResult.sessionId,
					messageAnalysis.messageHash,
				);
				await db
					.update(chatSessions)
					.set({
						lastUserMessageHash: messageAnalysis.messageHash,
						lastMessageRole: messageAnalysis.messageRole || null,
					})
					.where(eq(chatSessions.sessionId, sessionResult.sessionId));
			}
			return sessionResult;
		});
		const autoSessionInfo = autoSessionResult;
		const autoIsNewPrompt = autoSessionResult.isNewUserPrompt;

		// Assign turn_id for auto-model requests (same logic as regular proxy path)
		const autoTurnKey = `${autoSessionInfo.sessionId}:${keyRecord.id}`;
		let autoTurnId: string;
		if (autoIsNewPrompt) {
			autoTurnId = `turn_${generateSessionId().slice(0, 16)}`;
			turnIdCache.set(autoTurnKey, autoTurnId);
		} else {
			autoTurnId =
				turnIdCache.get(autoTurnKey) ||
				`turn_${generateSessionId().slice(0, 16)}`;
			turnIdCache.set(autoTurnKey, autoTurnId);
		}

		const wantedStream = requestBody?.stream === true;
		const tried: string[] = [];

		// Build blocked headers set once
		const blockedHeaders = new Set([
			'host',
			'content-length',
			'content-encoding',
			'authorization',
			'cookie',
			'connection',
			'keep-alive',
			'transfer-encoding',
			'upgrade',
		]);
		const baseHeaders: Record<string, string> = {};
		for (const [k, v] of c.req.raw.headers.entries()) {
			if (!blockedHeaders.has(k.toLowerCase())) baseHeaders[k] = v;
		}
		baseHeaders['x-forwarded-for'] = clientIp;

		for (const candidate of onlineModels) {
			// Resolve provider to get API key
			const providerRow = await db
				.select()
				.from(providers)
				.where(
					and(
						eq(providers.name, candidate.provider),
						eq(providers.isActive, true),
					),
				)
				.limit(1)
				.then((r) => r[0]);

			if (!providerRow) {
				tried.push(`${candidate.provider}/${candidate.modelId} (no provider)`);
				continue;
			}

			const isAnthropicAuto = providerRow.endpointType === 'anthropic';
			const upstreamUrl = isAnthropicAuto
				? resolveAnthropicUpstreamUrl(providerRow.endpoint)
				: (() => {
					const upstreamBase = providerRow.endpoint.replace(/\/$/, '');
					let upstreamPath = forwardPath;
					if (upstreamBase.endsWith('/v1') && upstreamPath.startsWith('/v1/')) {
						upstreamPath = upstreamPath.slice(3);
					} else if (upstreamBase.endsWith('/v1') && upstreamPath === '/v1') {
						upstreamPath = '';
					}
					return `${upstreamBase}${upstreamPath}`;
				})();

			const upstreamHeaders: Record<string, string> = { ...baseHeaders };
			// Use key rotation for auto-model trials too
			const trialKeyResult = await getNextApiKey(providerRow.id);
			if (!trialKeyResult) {
				tried.push(
					`${candidate.provider}/${candidate.modelId} (no available keys)`,
				);
				continue;
			}
			if (!isAnthropicAuto) {
				upstreamHeaders['Authorization'] = `Bearer ${trialKeyResult.apiKey}`;
			}
			if (contentType) upstreamHeaders['Content-Type'] = contentType;

			// Check per-model prompt limit for this candidate before sending request.
			// If exceeded, skip to next candidate model.
			{
				const mlCheck = await checkModelPromptLimit(
					keyRecord.id,
					candidate.modelId,
					keyRecord.perModelPromptLimit || 0,
					keyRecord.perModelPromptLimitWindow || null,
					config.globalPerModelPromptLimit || 0,
					config.globalPerModelPromptLimitWindow || '30m',
				);
				if (!mlCheck.allowed) {
					tried.push(
						`${candidate.provider}/${candidate.modelId} (model limit ${mlCheck.used}/${mlCheck.effectiveLimit})`,
					);
					continue;
				}
			}

			// ─── Token Limits for Auto Model (Daily & Monthly) ────────────────────
			// Same checks as non-auto path to prevent exceeding limits
			{
				const wibOffset = 7 * 60 * 60 * 1000;
				const wibNow = new Date(Date.now() + wibOffset);

				// Monthly token limit
				if (keyRecord.monthlyTokenLimit && keyRecord.monthlyTokenLimit > 0) {
					const mw = new Date(wibNow);
					mw.setUTCDate(1);
					mw.setUTCHours(0, 0, 0, 0);
					const ms = new Date(mw.getTime() - wibOffset);
					const mu = await db.select({ total: turnTotalTokensSql(
						and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ms}`, BILLABLE_LOG_SQL),
						tokenCountOpts(keyRecord),
					) }).from(requestLogs).where(and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ms}`, BILLABLE_LOG_SQL)).then((r: any[]) => r[0]);
					if (mu && mu.total >= keyRecord.monthlyTokenLimit) {
						tried.push(`${candidate.provider}/${candidate.modelId} (monthly token limit)`);
						continue;
					}
				}

				// Daily token limit
				const globalDailyTokenLimit = resolveKeyDailyTokenLimit(keyRecord, config);
				if (globalDailyTokenLimit > 0) {
					const dw = new Date(wibNow);
					dw.setUTCHours(0, 0, 0, 0);
					const ds = new Date(dw.getTime() - wibOffset);
					const du = await db.select({ total: turnTotalTokensSql(
						and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ds}`, BILLABLE_LOG_SQL),
						tokenCountOpts(keyRecord),
					) }).from(requestLogs).where(and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ds}`, BILLABLE_LOG_SQL)).then((r: any[]) => r[0]);
					if (du && du.total >= globalDailyTokenLimit) {
						tried.push(`${candidate.provider}/${candidate.modelId} (daily token limit)`);
						continue;
					}
				}

				// Daily Input Token Limit (skip for trial)
				const dailyInputLimit = !keyRecord.isTrial && (keyRecord.dailyInputTokenLimit && keyRecord.dailyInputTokenLimit > 0 ? keyRecord.dailyInputTokenLimit : config.globalDailyInputTokenLimit || 0);
				if (dailyInputLimit > 0) {
					const dw = new Date(wibNow);
					dw.setUTCHours(0, 0, 0, 0);
					const ds = new Date(dw.getTime() - wibOffset);
					const di = await db.select({ total: turnPromptTokensSql(
						and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ds}`, BILLABLE_LOG_SQL),
						tokenCountOpts(keyRecord),
					) }).from(requestLogs).where(and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ds}`, BILLABLE_LOG_SQL)).then((r: any[]) => r[0]);
					if (di && di.total >= dailyInputLimit) {
						tried.push(`${candidate.provider}/${candidate.modelId} (daily input token limit)`);
						continue;
					}
				}

				// Daily Output Token Limit (skip for trial)
				const dailyOutputLimit = !keyRecord.isTrial && (keyRecord.dailyOutputTokenLimit && keyRecord.dailyOutputTokenLimit > 0 ? keyRecord.dailyOutputTokenLimit : config.globalDailyOutputTokenLimit || 0);
				if (dailyOutputLimit > 0) {
					const dw = new Date(wibNow);
					dw.setUTCHours(0, 0, 0, 0);
					const ds = new Date(dw.getTime() - wibOffset);
					const do_ = await db.select({ total: turnCompletionTokensSql(
						and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ds}`, BILLABLE_LOG_SQL),
						tokenCountOpts(keyRecord),
					) }).from(requestLogs).where(and(eq(requestLogs.apiKeyId, keyRecord.id), sql`created_at >= ${ds}`, BILLABLE_LOG_SQL)).then((r: any[]) => r[0]);
					if (do_ && do_.total >= dailyOutputLimit) {
						tried.push(`${candidate.provider}/${candidate.modelId} (daily output token limit)`);
						continue;
					}
				}
			}

			// Build body with this specific model
			const trialBody = {
				...requestBody,
				model: candidate.modelId,
				stream: wantedStream,
			};
			const trialBodyPayload = isAnthropicAuto
				? prepareAnthropicUpstreamBody(trialBody)
				: new TextEncoder().encode(JSON.stringify(trialBody));

			try {
				const trialResponse = await fetchUpstreamWithRetry(
					upstreamUrl,
					{
						method: c.req.method,
						headers: isAnthropicAuto
							? buildAnthropicUpstreamHeaders(trialKeyResult.apiKey, upstreamHeaders)
							: upstreamHeaders,
						body: trialBodyPayload as any,
					},
					wantedStream,
					c.req.raw.signal,
				);

				if (trialResponse.status === 429 || trialResponse.status === 401) {
					// Rate limited or Invalid Key — mark key and try next model
					await markKeyAsLimited(trialKeyResult.keyId);
				}
				if (trialResponse.status >= 400) {
					tried.push(
						`${candidate.provider}/${candidate.modelId} (HTTP ${trialResponse.status})`,
					);
					try {
						await trialResponse.body?.cancel();
					} catch {}
					continue;
				}

				// ── Success! This model works ──────────────────────────────────────
				const actualModel = `${candidate.provider}/${candidate.modelId}`;

				if (wantedStream) {
					// Streaming: pipe directly to client with token accumulation
					const responseHeaders: Record<string, string> = {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
						'x-model-used': actualModel,
					};
					if (tried.length > 0)
						responseHeaders['x-auto-model-tried'] = tried.join(', ');

					if (trialResponse.body) {
						const acc = makeAccumulator();
						const decoder = new TextDecoder();
						const logModel = `auto (${candidate.modelId}) [stream]`;

						const { readable, writable } = new TransformStream({
							transform(chunk, controller) {
								controller.enqueue(chunk);
								try {
									const text = decoder.decode(chunk, { stream: true });
									const lines = text.split('\n');
									for (const line of lines) {
										if (line.startsWith('data: ') && line !== 'data: [DONE]') {
											const payloadText = line.slice(6).trim();
											if (!payloadText || payloadText === '[DONE]') continue;
											try {
												const data = JSON.parse(payloadText);
												consumeStreamPayload(acc, data);
											} catch {}
										}
									}
								} catch {}
							},
							flush() {
								const finalized = finalizeCompletion(acc);
								const rawCompletionTokens = finalized.completionTokens
									? finalized.completionTokens
									: finalized.completionText
										? Math.max(estimateTokens(finalized.completionText), 1)
										: 0;
								const billableTokens = resolveBillableTokens(
									{
										promptTokens: finalized.promptTokens,
										completionTokens: rawCompletionTokens,
										cachedTokens: finalized.cachedTokens,
									},
									contextTokensBefore,
									fullLastUserTurnText,
								);
								const latencyMs = Date.now() - startTime;
								enqueueLogWrite(async (tx) => {
									await tx.insert(requestLogs).values({
										apiKeyId: keyRecord.id,
										apiKeyName: keyRecord.name,
										userAgentRaw: userAgent || null,
										osDetected,
										clientName: clientName || ide,
										ipAddress: clientIp,
										deviceFingerprint: fingerprint,
										ideDetected: ide,
										provider: candidate.provider,
										endpointPath: path,
										sessionId: autoSessionInfo.sessionId,
										turnId: autoTurnId,
										model: logModel,
										promptTokens: billableTokens.promptTokens,
										completionTokens: billableTokens.completionTokens,
										totalTokens: billableTokens.totalTokens,
										cachedTokens: billableTokens.cachedTokens,
										contextFingerprint: contextFingerprint || null,
										contextTokensBefore,
										contextDeltaTokens: autoSessionInfo.contextDeltaTokens,
										contextEvent: autoSessionInfo.contextEvent,
										latencyMs,
										statusCode: trialResponse.status,
										requestPreview: requestPreview || null,
										responsePreview:
											finalized.completionText?.substring(0, 200) || null,
										isCountedRequest: autoIsNewPrompt ? true : false,
										isBillableToken: true,
										estimatedCost: calculateEstimatedCost(
											candidate.modelId,
											billableTokens.promptTokens,
											billableTokens.completionTokens,
										),
									});
									logEmitter.emit({
										model: logModel,
										provider: candidate.provider,
										statusCode: trialResponse.status,
										latencyMs,
									});
									// Update session stats for auto model
									if (autoIsNewPrompt) {
										await updateSessionAfterRequest(tx, {
											sessionId: autoSessionInfo.sessionId,
											ipAddress: clientIp,
											ideDetected: ide,
											provider: candidate.provider,
											model: `auto (${candidate.modelId})`,
											contextFingerprint,
											contextTokensBefore,
											requestPreview,
											totalTokens: billableTokens.totalTokens || 0,
											estimatedCost: calculateEstimatedCost(
												candidate.modelId,
												billableTokens.promptTokens,
												billableTokens.completionTokens,
											),
											contextEvent: autoSessionInfo.contextEvent,
											isNewPrompt: autoIsNewPrompt,
											messageAnalysis,
											hasActualToolCalls: false,
										});
									}

									// Update prompt_window_start for global and per-model limits
									if (autoIsNewPrompt) {
										const autoGlobalWindowStr = keyRecord.promptLimitWindow || config.globalPromptLimitWindow || '30m';
										const autoGlobalWindowMs = parseRateLimitWindow(autoGlobalWindowStr);
										let autoGlobalWindowStartMs = 0;
										if (keyRecord.promptWindowStart) {
											autoGlobalWindowStartMs = Date.parse(keyRecord.promptWindowStart.replace(' ', 'T') + 'Z');
										}
										const autoNowMs = Date.now();
										const autoNowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
										if (!autoGlobalWindowStartMs || autoNowMs >= autoGlobalWindowStartMs + autoGlobalWindowMs) {
											await tx.update(apiKeys).set({ promptWindowStart: autoNowStr }).where(eq(apiKeys.id, keyRecord.id));
										}
										// Per-model window start — use pattern-aware helper so substring
										// overrides like "claude" also match the candidate model.
										const autoActiveOverride = await findActiveOverrideInTx(tx, keyRecord.id, candidate.modelId);
										if (autoActiveOverride) {
											const autoModelWindowStr = keyRecord.perModelPromptLimitWindow || config.globalPerModelPromptLimitWindow || '30m';
											const autoModelWindowMs = parseRateLimitWindow(autoModelWindowStr);
											let autoModelWindowStartMs = 0;
											if (autoActiveOverride.promptWindowStart) {
												autoModelWindowStartMs = Date.parse(autoActiveOverride.promptWindowStart.replace(' ', 'T') + 'Z');
											}
											if (!autoModelWindowStartMs || autoNowMs >= autoModelWindowStartMs + autoModelWindowMs) {
												await tx.update(modelLimits).set({ promptWindowStart: autoNowStr }).where(eq(modelLimits.id, autoActiveOverride.id));
											}
										}
									}
								});
							},
						});

						trialResponse.body.pipeTo(writable).catch((err) => {
							console.error('[auto-stream] pipeTo error:', err?.message || err);
						});
						return new Response(readable, {
							status: trialResponse.status,
							headers: responseHeaders,
						});
					}

					return new Response(trialResponse.body, {
						status: trialResponse.status,
						headers: responseHeaders,
					});
				}

				// Non-streaming: check if response has actual content
				const trialText = await trialResponse.text();
				let hasContent = false;
				let responseJson: any = null;
				try {
					responseJson = JSON.parse(trialText);
					const choice0 = responseJson?.choices?.[0];
					const msgContent = choice0?.message?.content;
					const toolCalls = choice0?.message?.tool_calls;
					hasContent = !!(msgContent || toolCalls);
				} catch {
					// Not JSON or unparseable — treat as no content
				}

				if (!hasContent) {
					tried.push(
						`${candidate.provider}/${candidate.modelId} (empty response)`,
					);
					continue;
				}

				// Non-streaming success: return with model info injected
				if (responseJson && typeof responseJson === 'object') {
					responseJson.model = `auto (${candidate.modelId})`;
				}
				const finalBody = responseJson
					? JSON.stringify(responseJson)
					: trialText;

				const responseHeaders: Record<string, string> = {
					'Content-Type': 'application/json',
					'x-model-used': actualModel,
				};
				if (tried.length > 0)
					responseHeaders['x-auto-model-tried'] = tried.join(', ');

				// Log the auto model request
				const latencyMs = Date.now() - startTime;
				const completionTokens =
					responseJson?.usage?.completion_tokens || estimateTokens(trialText);
				const promptTokens = responseJson?.usage?.prompt_tokens || 0;
				const cachedTokens =
					responseJson?.usage?.prompt_tokens_details?.cached_tokens || 0;
				const billableInput = Math.max(promptTokens - cachedTokens, 0);
				enqueueLogWrite(async (tx) => {
					await tx.insert(requestLogs).values({
						apiKeyId: keyRecord.id,
						apiKeyName: keyRecord.name,
						userAgentRaw: userAgent || null,
						osDetected,
						clientName: clientName || ide,
						ipAddress: clientIp,
						deviceFingerprint: fingerprint,
						ideDetected: ide,
						provider: candidate.provider,
						endpointPath: path,
						sessionId: autoSessionInfo.sessionId,
						turnId: autoTurnId,
						model: `auto (${candidate.modelId})`,
						promptTokens: billableInput,
						completionTokens,
						totalTokens: billableInput + completionTokens,
						cachedTokens,
						contextFingerprint: contextFingerprint || null,
						contextTokensBefore,
						contextDeltaTokens: autoSessionInfo.contextDeltaTokens,
						contextEvent: autoSessionInfo.contextEvent,
						latencyMs,
						statusCode: 200,
						estimatedCost: calculateEstimatedCost(
							candidate.modelId,
							billableInput,
							completionTokens,
						),
						requestPreview: requestPreview || null,
						responsePreview:
							responseJson?.choices?.[0]?.message?.content?.substring(0, 200) ||
							null,
						isCountedRequest: autoIsNewPrompt ? true : false,
						isBillableToken: true,
					});
					logEmitter.emit({
						model: `auto (${candidate.modelId})`,
						provider: candidate.provider,
						statusCode: 200,
						latencyMs,
					});
					// Update session stats for auto model (non-streaming)
					if (autoIsNewPrompt) {
						await updateSessionAfterRequest(tx, {
							sessionId: autoSessionInfo.sessionId,
							ipAddress: clientIp,
							ideDetected: ide,
							provider: candidate.provider,
							model: `auto (${candidate.modelId})`,
							contextFingerprint,
							contextTokensBefore,
							requestPreview,
							totalTokens: billableInput + completionTokens,
							estimatedCost: calculateEstimatedCost(
								candidate.modelId,
								billableInput,
								completionTokens,
							),
							contextEvent: autoSessionInfo.contextEvent,
							isNewPrompt: autoIsNewPrompt,
							messageAnalysis,
							hasActualToolCalls: false,
						});
					}

					// Update prompt_window_start for global and per-model limits
					if (autoIsNewPrompt) {
						const autoGlobalWindowStr = keyRecord.promptLimitWindow || config.globalPromptLimitWindow || '30m';
						const autoGlobalWindowMs = parseRateLimitWindow(autoGlobalWindowStr);
						let autoGlobalWindowStartMs = 0;
						if (keyRecord.promptWindowStart) {
							autoGlobalWindowStartMs = Date.parse(keyRecord.promptWindowStart.replace(' ', 'T') + 'Z');
						}
						const autoNowMs2 = Date.now();
						const autoNowStr2 = new Date().toISOString().replace('T', ' ').substring(0, 19);
						if (!autoGlobalWindowStartMs || autoNowMs2 >= autoGlobalWindowStartMs + autoGlobalWindowMs) {
							await tx.update(apiKeys).set({ promptWindowStart: autoNowStr2 }).where(eq(apiKeys.id, keyRecord.id));
						}
						// Per-model window start — pattern-aware
						const autoActiveOverride2 = await findActiveOverrideInTx(tx, keyRecord.id, candidate.modelId);
						if (autoActiveOverride2) {
							const autoModelWindowStr2 = keyRecord.perModelPromptLimitWindow || config.globalPerModelPromptLimitWindow || '30m';
							const autoModelWindowMs2 = parseRateLimitWindow(autoModelWindowStr2);
							let autoModelWindowStartMs2 = 0;
							if (autoActiveOverride2.promptWindowStart) {
								autoModelWindowStartMs2 = Date.parse(autoActiveOverride2.promptWindowStart.replace(' ', 'T') + 'Z');
							}
							if (!autoModelWindowStartMs2 || autoNowMs2 >= autoModelWindowStartMs2 + autoModelWindowMs2) {
								await tx.update(modelLimits).set({ promptWindowStart: autoNowStr2 }).where(eq(modelLimits.id, autoActiveOverride2.id));
							}
						}
					}
				});

				return new Response(finalBody, {
					status: 200,
					headers: responseHeaders,
				});
			} catch (err: any) {
				tried.push(
					`${candidate.provider}/${candidate.modelId} (error: ${err?.message || 'unknown'})`,
				);
				continue;
			}
		}

		// All models exhausted
		return c.json(
			{
				error: {
					message: `Auto model: all ${onlineModels.length} online models failed`,
					type: 'model_offline',
					tried,
				},
			},
			503,
		);
	}

	const targetProvider = await getProviderForModel(model);
	if (!targetProvider) {
		return c.json(
			{
				error: {
					message: `No active upstream provider available for model "${model}"`,
					type: 'server_error',
				},
			},
			500,
		);
	}

	if (keyRecord.isTrial && !isGpyProviderOrModel(targetProvider.name, model)) {
		return c.json(
			{
				error: {
					message: `Trial users may only use gpy provider models. Requested: "${model}"`,
					type: 'access_error',
					code: 'trial_model_not_allowed',
				},
			},
			403,
		);
	}

	// Strip provider prefix for upstream request: "tokito/glm/glm-5.1" -> "glm/glm-5.1"
	const upstreamModel = await stripProviderPrefix(model);

	// Modify requestBody to use clean model name for upstream request
	if (requestBody && model !== upstreamModel) {
		requestBody.model = upstreamModel;
		// Re-encode body bytes with modified model
		const bodyStr = JSON.stringify(requestBody);
		requestBodyBytes = new TextEncoder().encode(bodyStr);
	}

	// ─── 8a. Model Monitor Check ─────────────────────────────────────────
	// Block only when monitor has data for this model AND none of the latest checks are online.
	// Trial users bypass offline gate (upstream retry handles failures).
	// `conduit` provider bypasses offline gate too (conduit.ozdoev.net is transient upstream 502s).
	if (
		!keyRecord.isTrial &&
		targetProvider.name !== 'conduit' &&
		upstreamModel &&
		upstreamModel !== 'unknown'
	) {
		const monitorRows = await db
			.select()
			.from(modelMonitor)
			.where(eq(modelMonitor.modelId, upstreamModel))
			.orderBy(desc(modelMonitor.checkedAt))
			.limit(20);

		if (monitorRows.length > 0) {
			const hasOnline = monitorRows.some(
				(row) => row.isOnline && row.httpStatus === 200,
			);
			if (!hasOnline) {
				const onlineModels = await db
					.select({ modelId: modelMonitor.modelId })
					.from(modelMonitor)
					.where(eq(modelMonitor.isOnline, true))
					.orderBy(modelMonitor.modelId);

				const seen = new Set<string>();
				const uniqueOnline: string[] = [];
				for (const m of onlineModels) {
					if (!seen.has(m.modelId)) {
						seen.add(m.modelId);
						uniqueOnline.push(m.modelId);
					}
				}

				return c.json(
					{
						error: {
							message: `Model "${model}" is currently offline. Try another model.`,
							type: 'model_offline',
							available_models: uniqueOnline,
						},
					},
					503,
				);
			}
		}
	}

	// ΓöÇΓöÇΓöÇ 8b. Title gen / internal IDE requests: forward without session tracking ΓöÇ
	// These are auto-generated by the IDE (e.g. generating chat title) and must
	// NOT create sessions, NOT count as prompts, NOT check limits.
	if (isTitleGenRequest(requestBody)) {
		const targetProvider2 = await getProviderForModel(model);
		if (!targetProvider2) {
			return c.json(
				{
					error: {
						message: `No active upstream provider`,
						type: 'server_error',
					},
				},
				500,
			);
		}
		const upstreamBase2 = targetProvider2.endpoint.replace(/\/$/, '');
		const isAnthropicTitleGen = targetProvider2.endpointType === 'anthropic';
		let upstreamUrl2 = isAnthropicTitleGen
			? resolveAnthropicUpstreamUrl(targetProvider2.endpoint)
			: (() => {
				let upstreamPath2 = forwardPath;
				if (upstreamBase2.endsWith('/v1') && upstreamPath2.startsWith('/v1/'))
					upstreamPath2 = upstreamPath2.slice(3);
				return `${upstreamBase2}${upstreamPath2}`;
			})();
		const upstreamHeaders2: Record<string, string> = {};
		const blocked2 = new Set([
			'host',
			'content-length',
			'content-encoding',
			'authorization',
			'cookie',
			'connection',
			'keep-alive',
			'transfer-encoding',
			'upgrade',
		]);
		for (const [k, v] of c.req.raw.headers.entries()) {
			if (!blocked2.has(k.toLowerCase())) upstreamHeaders2[k] = v;
		}
		upstreamHeaders2['x-forwarded-for'] = clientIp;
		if (contentType) upstreamHeaders2['Content-Type'] = contentType;
		try {
			const titleGenBody = isAnthropicTitleGen
				? prepareAnthropicUpstreamBody(requestBody)
				: (requestBodyBytes as BodyInit);
			const { response: resp } = await fetchWithKeyRotation(
				targetProvider2.id,
				upstreamUrl2,
				(apiKey) => {
					if (isAnthropicTitleGen) {
						return {
							method: c.req.method,
							headers: buildAnthropicUpstreamHeaders(apiKey, upstreamHeaders2),
							body: titleGenBody,
						};
					}
					return {
						method: c.req.method,
						headers: {
							...upstreamHeaders2,
							Authorization: `Bearer ${apiKey}`,
						},
						body: requestBodyBytes as any,
					};
				},
				requestBody?.stream === true,
				c.req.raw.signal,
			);
			if (isAnthropicTitleGen && !requestBody?.stream && resp.ok) {
				const raw = await resp.text();
				try {
					const openaiResponse = convertResponseToOpenAI(JSON.parse(raw));
					return new Response(JSON.stringify(openaiResponse), {
						status: resp.status,
						headers: { 'Content-Type': 'application/json' },
					});
				} catch {
					return new Response(raw, {
						status: resp.status,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			}
			return new Response(resp.body, {
				status: resp.status,
				headers: resp.headers,
			});
		} catch {
			return c.json(
				{ error: { message: 'Upstream request failed', type: 'server_error' } },
				502,
			);
		}
	}

	// ΓöÇΓöÇΓöÇ 9. Get Upstream Config & Session Info ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	// Wrapped in a per-device lock so concurrent requests from the same device
	// are serialized.  This prevents race conditions where two requests both
	// see "no session" and create duplicate sessions, or both read stale hash.
	const provider = targetProvider.name;
	const deviceLockKey = `${keyRecord.id}:${fingerprint}`;
	const { sessionInfo, isNewPrompt, consecutiveToolFollowups } =
		await withDeviceLock(deviceLockKey, async () => {
			const sessionInfo = await resolveChatSession({
				apiKeyId: keyRecord.id,
				apiKeyName: keyRecord.name,
				ipAddress: clientIp,
				deviceFingerprint: fingerprint,
				ideDetected: ide,
				provider,
				model,
				contextFingerprint,
				contextTokensBefore,
				requestPreview,
				messageAnalysis,
				requestBody,
				requestToolCount: requestToolNames.length,
			});

			const isNewPrompt = sessionInfo.isNewUserPrompt;

			// We fetch the latest session row here to check consecutive tool followups
			let consecutiveCount = 0;
			if (sessionInfo.sessionId) {
				const dbSess = await db
					.select({
						consecutiveToolFollowups: chatSessions.consecutiveToolFollowups,
					})
					.from(chatSessions)
					.where(eq(chatSessions.sessionId, sessionInfo.sessionId))
					.then((r) => r[0]);
				consecutiveCount = dbSess?.consecutiveToolFollowups || 0;
			}

			// Sync non-hash session tracking before upstream (hash updated only after successful count).
			{
				const syncUpdates: Record<string, any> = {
					lastSeenAt: new Date(),
					model,
				};
				if (messageAnalysis.messageRole) {
					syncUpdates.lastMessageRole = messageAnalysis.messageRole;
				}
				if (contextTokensBefore > 0) {
					syncUpdates.lastContextTokens = contextTokensBefore;
				}
				if (contextFingerprint) {
					syncUpdates.contextFingerprint = contextFingerprint;
				}
				await db
					.update(chatSessions)
					.set(syncUpdates)
					.where(eq(chatSessions.sessionId, sessionInfo.sessionId));
			}

			return {
				sessionInfo,
				isNewPrompt,
				consecutiveToolFollowups: consecutiveCount,
			};
		});

	// Check for infinite tool loops removed as per user request to act as pure pass-through

	// ΓöÇΓöÇΓöÇ 10. Prompt & Model Limit Checks ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	//
	// Per-model limit: checked for EVERY request (not just new prompts).
	// Trial keys use global prompt limit only — skip per-model global overrides.
	if (!keyRecord.isTrial) {
		const mlCheck = await checkModelPromptLimit(
			keyRecord.id,
			model,
			keyRecord.perModelPromptLimit || 0,
			keyRecord.perModelPromptLimitWindow || null,
			config.globalPerModelPromptLimit || 0,
			config.globalPerModelPromptLimitWindow || '30m',
		);
		if (!mlCheck.allowed) {
			const windowStr =
				keyRecord.perModelPromptLimitWindow ||
				config.globalPerModelPromptLimitWindow ||
				'30m';
			const windowMs = parseRateLimitWindow(windowStr);
			const resetMs = await getWindowResetMs(keyRecord.id, windowMs, model);
			const resetMins = Math.ceil(resetMs / 60000);
			const globalLimit =
				(keyRecord.promptLimit && keyRecord.promptLimit > 0
					? keyRecord.promptLimit
					: config.globalPromptLimit) || 0;
			const globalWindow =
				keyRecord.promptLimitWindow || config.globalPromptLimitWindow || '30m';
			const globalCheck =
				globalLimit > 0
					? await checkPromptLimit(keyRecord.id, globalLimit, globalWindow)
					: null;
			const globalRemaining = globalCheck ? globalCheck.remaining : -1;
			const isKeyOverride = (keyRecord.perModelPromptLimit || 0) > 0;
			const limitSource = isKeyOverride
				? "your key's override"
				: 'global default';
			const globalInfo =
				globalRemaining >= 0
					? ` You have ${globalRemaining} prompt(s) remaining for other models.`
					: '';
			return c.json(
				{
					error: {
						message: `Limit reached for model "${model}" (${limitSource}): ${mlCheck.used}/${mlCheck.effectiveLimit} prompts used. Resets in ~${resetMins} minute(s).${globalInfo}`,
						type: 'rate_limit_error',
						code: 'model_prompt_limit_exceeded',
					},
				},
				429,
				{
					'x-model-prompt-limit': String(mlCheck.effectiveLimit),
					'x-model-prompt-remaining': '0',
					'x-model-prompt-used': String(mlCheck.used),
					'x-model-prompt-reset-mins': String(resetMins),
				},
			);
		}
	}

	// Global / Per-Key Prompt Limit (all models combined) ΓÇö checked for EVERY request
	// so retries cannot bypass the limit when isNewPrompt=false.
	{
		const { limit: effectivePromptLimit, window: effectivePromptLimitWindow } =
			resolveKeyPromptLimit(keyRecord, config);

		if (effectivePromptLimit > 0) {
			const plCheck = await checkPromptLimit(
				keyRecord.id,
				effectivePromptLimit,
				effectivePromptLimitWindow,
			);
			if (!plCheck.allowed) {
				const windowMs = parseRateLimitWindow(effectivePromptLimitWindow);
				const resetMs = await getWindowResetMs(keyRecord.id, windowMs);
				const resetMins = Math.ceil(resetMs / 60000);
				const isKeyOverride = (keyRecord.promptLimit || 0) > 0;
				const trialTag = keyRecord.isTrial ? ' (trial)' : '';
				const limitMsg = `All model limit reached${isKeyOverride ? ' (key override)' : ''}${trialTag}: ${plCheck.used}/${effectivePromptLimit} prompts used in this ${effectivePromptLimitWindow} window. Resets in ~${resetMins} minute(s).`;
				await notifyTrialLimitIfNeeded(keyRecord, limitMsg);
				return c.json(
					{
						error: {
							message: limitMsg,
							type: 'rate_limit_error',
							code: 'prompt_limit_exceeded',
						},
					},
					429,
					{
						'x-prompt-limit': String(effectivePromptLimit),
						'x-prompt-remaining': '0',
						'x-prompt-used': String(plCheck.used),
						'x-prompt-reset-mins': String(resetMins),
					},
				);
			}
		}
	}

	// ─── Token Limits (Daily & Monthly) ────────────────────────────────────
	// Checked on ALL requests. If already exceeded, block.
	// Otherwise let through - may push slightly over, blocked on NEXT request.
	{
		const normalizedModelForToken = await normalizeModelForLimit(model);
		const modelOverride = await findActiveOverride(keyRecord.id, normalizedModelForToken);

		const wibOffset = 7 * 60 * 60 * 1000;
		const wibNow = new Date(Date.now() + wibOffset);

		if (keyRecord.monthlyTokenLimit && keyRecord.monthlyTokenLimit > 0) {
			const mw = new Date(wibNow);
			mw.setUTCDate(1);
			mw.setUTCHours(0, 0, 0, 0);
			const ms = new Date(mw.getTime() - wibOffset);
			const whereClause = and(
				eq(requestLogs.apiKeyId, keyRecord.id),
				sql`created_at >= ${ms}`,
				BILLABLE_LOG_SQL,
			);
			const mu = await db
				.select({ total: turnTotalTokensSql(whereClause, tokenCountOpts(keyRecord)) })
				.from(requestLogs)
				.where(whereClause)
				.then((r) => r[0]);
			if (mu && mu.total >= keyRecord.monthlyTokenLimit) {
				return c.json(
					{
						error: {
							message: `Monthly token limit reached: ${mu.total.toLocaleString()}/${keyRecord.monthlyTokenLimit.toLocaleString()} tokens.`,
							type: 'rate_limit_error',
							code: 'monthly_token_limit_exceeded',
						},
					},
					429,
				);
			}
		}

		const globalDailyTokenLimit = resolveKeyDailyTokenLimit(keyRecord, config);
		if (globalDailyTokenLimit > 0) {
			const dw = new Date(wibNow);
			dw.setUTCHours(0, 0, 0, 0);
			const ds = new Date(dw.getTime() - wibOffset);
			const whereClause = and(
				eq(requestLogs.apiKeyId, keyRecord.id),
				sql`created_at >= ${ds}`,
				BILLABLE_LOG_SQL,
			);
			const du = await db
				.select({ total: turnTotalTokensSql(whereClause, tokenCountOpts(keyRecord)) })
				.from(requestLogs)
				.where(whereClause)
				.then((r) => r[0]);
			if (du && du.total >= globalDailyTokenLimit) {
				const limitMsg = `Daily token limit reached: ${du.total.toLocaleString()}/${globalDailyTokenLimit.toLocaleString()} tokens today. Resets tomorrow.`;
				await notifyTrialLimitIfNeeded(keyRecord, limitMsg);
				return c.json(
					{
						error: {
							message: limitMsg,
							type: 'rate_limit_error',
							code: 'daily_token_limit_exceeded',
						},
					},
					429,
				);
			}
		}

		// Daily Input Token Limit (per-key override or global) — skip for trial keys
		if (!keyRecord.isTrial) {
		const dailyInputLimit =
			keyRecord.dailyInputTokenLimit && keyRecord.dailyInputTokenLimit > 0
				? keyRecord.dailyInputTokenLimit
				: config.globalDailyInputTokenLimit || 0;
		if (dailyInputLimit > 0) {
			const dw = new Date(wibNow);
			dw.setUTCHours(0, 0, 0, 0);
			const ds = new Date(dw.getTime() - wibOffset);
			const whereClause = and(
				eq(requestLogs.apiKeyId, keyRecord.id),
				sql`created_at >= ${ds}`,
				BILLABLE_LOG_SQL,
			);
			const du = await db
				.select({ total: turnPromptTokensSql(whereClause, tokenCountOpts(keyRecord)) })
				.from(requestLogs)
				.where(whereClause)
				.then((r) => r[0]);
			if (du && du.total >= dailyInputLimit) {
				return c.json(
					{
						error: {
							message: `Daily input token limit reached: ${du.total.toLocaleString()}/${dailyInputLimit.toLocaleString()} input tokens today. Resets tomorrow.`,
							type: 'rate_limit_error',
							code: 'daily_input_token_limit_exceeded',
						},
					},
					429,
				);
			}
		}

		// Daily Output Token Limit (per-key override or global)
		const dailyOutputLimit =
			keyRecord.dailyOutputTokenLimit && keyRecord.dailyOutputTokenLimit > 0
				? keyRecord.dailyOutputTokenLimit
				: config.globalDailyOutputTokenLimit || 0;
		if (dailyOutputLimit > 0) {
			const dw = new Date(wibNow);
			dw.setUTCHours(0, 0, 0, 0);
			const ds = new Date(dw.getTime() - wibOffset);
			const whereClause = and(
				eq(requestLogs.apiKeyId, keyRecord.id),
				sql`created_at >= ${ds}`,
				BILLABLE_LOG_SQL,
			);
			const du = await db
				.select({ total: turnCompletionTokensSql(whereClause, tokenCountOpts(keyRecord)) })
				.from(requestLogs)
				.where(whereClause)
				.then((r) => r[0]);
			if (du && du.total >= dailyOutputLimit) {
				return c.json(
					{
						error: {
							message: `Daily output token limit reached: ${du.total.toLocaleString()}/${dailyOutputLimit.toLocaleString()} output tokens today. Resets tomorrow.`,
							type: 'rate_limit_error',
							code: 'daily_output_token_limit_exceeded',
						},
					},
					429,
				);
			}
		}

		const globalMonthlyTokenLimit = config.globalMonthlyTokenLimit || 0;
		if (globalMonthlyTokenLimit > 0) {
			const mw2 = new Date(wibNow);
			mw2.setUTCDate(1);
			mw2.setUTCHours(0, 0, 0, 0);
			const ms2 = new Date(mw2.getTime() - wibOffset);
			const whereClause = and(
				eq(requestLogs.apiKeyId, keyRecord.id),
				sql`created_at >= ${ms2}`,
				BILLABLE_LOG_SQL,
			);
			const mu2 = await db
				.select({ total: turnTotalTokensSql(whereClause, tokenCountOpts(keyRecord)) })
				.from(requestLogs)
				.where(whereClause)
				.then((r) => r[0]);
			if (mu2 && mu2.total >= globalMonthlyTokenLimit) {
				return c.json(
					{
						error: {
							message: `Monthly token limit reached: ${mu2.total.toLocaleString()}/${globalMonthlyTokenLimit.toLocaleString()} tokens. Resets next month.`,
							type: 'rate_limit_error',
							code: 'global_monthly_token_limit_exceeded',
						},
					},
					429,
				);
			}
		}
		} // end !keyRecord.isTrial global input/output/monthly limits

		// Model Specific Token Limits
		if (!keyRecord.isTrial && modelOverride) {
			const {
				dailyTokenLimit: overrideDailyToken,
				monthlyTokenLimit: overrideMonthlyToken,
				dailyInputTokenLimit: overrideDailyInputToken,
				dailyOutputTokenLimit: overrideDailyOutputToken,
			} = modelOverride;

			const dw = new Date(wibNow);
			dw.setUTCHours(0, 0, 0, 0);
			const ds = new Date(dw.getTime() - wibOffset);
			const mw = new Date(wibNow);
			mw.setUTCDate(1);
			mw.setUTCHours(0, 0, 0, 0);
			const ms = new Date(mw.getTime() - wibOffset);

			if (overrideDailyToken && overrideDailyToken > 0) {
				const whereClause = and(
					eq(requestLogs.apiKeyId, keyRecord.id),
					eq(requestLogs.model, model),
					sql`created_at >= ${ds}`,
					BILLABLE_LOG_SQL,
				);
				const du = await db
					.select({ total: turnTotalTokensSql(whereClause, tokenCountOpts(keyRecord)) })
					.from(requestLogs)
					.where(whereClause)
					.then((r) => r[0]);
				if (du && du.total >= overrideDailyToken) {
					return c.json(
						{
							error: {
								message: `Daily token limit reached for model "${model}": ${du.total.toLocaleString()}/${overrideDailyToken.toLocaleString()} tokens today. Resets tomorrow.`,
								type: 'rate_limit_error',
								code: 'model_daily_token_limit_exceeded',
							},
						},
						429,
					);
				}
			}

			if (overrideMonthlyToken && overrideMonthlyToken > 0) {
				const whereClause = and(
					eq(requestLogs.apiKeyId, keyRecord.id),
					eq(requestLogs.model, model),
					sql`created_at >= ${ms}`,
					BILLABLE_LOG_SQL,
				);
				const mu = await db
					.select({ total: turnTotalTokensSql(whereClause, tokenCountOpts(keyRecord)) })
					.from(requestLogs)
					.where(whereClause)
					.then((r) => r[0]);
				if (mu && mu.total >= overrideMonthlyToken) {
					return c.json(
						{
							error: {
								message: `Monthly token limit reached for model "${model}": ${mu.total.toLocaleString()}/${overrideMonthlyToken.toLocaleString()} tokens. Resets next month.`,
								type: 'rate_limit_error',
								code: 'model_monthly_token_limit_exceeded',
							},
						},
						429,
					);
				}
			}

			if (overrideDailyInputToken && overrideDailyInputToken > 0) {
				const whereClause = and(
					eq(requestLogs.apiKeyId, keyRecord.id),
					eq(requestLogs.model, model),
					sql`created_at >= ${ds}`,
					BILLABLE_LOG_SQL,
				);
				const du = await db
					.select({ total: turnPromptTokensSql(whereClause, tokenCountOpts(keyRecord)) })
					.from(requestLogs)
					.where(whereClause)
					.then((r) => r[0]);
				if (du && du.total >= overrideDailyInputToken) {
					return c.json(
						{
							error: {
								message: `Daily input token limit reached for model "${model}": ${du.total.toLocaleString()}/${overrideDailyInputToken.toLocaleString()} input tokens today. Resets tomorrow.`,
								type: 'rate_limit_error',
								code: 'model_daily_input_token_limit_exceeded',
							},
						},
						429,
					);
				}
			}

			if (overrideDailyOutputToken && overrideDailyOutputToken > 0) {
				const whereClause = and(
					eq(requestLogs.apiKeyId, keyRecord.id),
					eq(requestLogs.model, model),
					sql`created_at >= ${ds}`,
					BILLABLE_LOG_SQL,
				);
				const du = await db
					.select({ total: turnCompletionTokensSql(whereClause, tokenCountOpts(keyRecord)) })
					.from(requestLogs)
					.where(whereClause)
					.then((r) => r[0]);
				if (du && du.total >= overrideDailyOutputToken) {
					return c.json(
						{
							error: {
								message: `Daily output token limit reached for model "${model}": ${du.total.toLocaleString()}/${overrideDailyOutputToken.toLocaleString()} output tokens today. Resets tomorrow.`,
								type: 'rate_limit_error',
								code: 'model_daily_output_token_limit_exceeded',
							},
						},
						429,
					);
				}
			}
		}
	}

	const upstreamBase = targetProvider.endpoint.replace(/\/$/, '');
	let upstreamPath = forwardPath; // use forwardPath (may be converted from /v1/responses)
	// Avoid /v1 duplication if upstream endpoint already ends with /v1
	if (upstreamBase.endsWith('/v1') && upstreamPath.startsWith('/v1/')) {
		upstreamPath = upstreamPath.slice(3);
	} else if (upstreamBase.endsWith('/v1') && upstreamPath === '/v1') {
		upstreamPath = '';
	}
	const upstreamUrl = `${upstreamBase}${upstreamPath}`;
	const isStreaming = requestBody?.stream === true;

	const toolNameSet = new Set<string>(requestToolNames);
	const appendToolsFromPayload = (payload: any) => {
		const tools = extractToolNamesFromPayload(payload);
		for (const name of tools) {
			toolNameSet.add(name);
		}
	};

	const persistLogAndSession = async (
		logEntry: Record<string, any>,
		hasActualToolCalls: boolean,
		shouldCountRequest: boolean = true,
	) => {
		// Filter out empty responses (200 OK but no actual AI response)
		const hasActualContent = (entry: Record<string, any>): boolean => {
			const completionTokens = entry.completionTokens || 0;
			const promptTokens = entry.promptTokens || 0;
			// Don't count if both are zero (empty response with no tokens)
			return completionTokens > 0 || promptTokens > 0;
		};

		const counted =
			isNewPrompt && shouldCountRequest && hasActualContent(logEntry);

		// Calculate billable flat. Every successful request to upstream uses tokens.
		let isBillableToken = false;
		if (shouldCountRequest && hasActualContent(logEntry)) {
			isBillableToken = true;
		}

		// Assign turn_id: new turn for user prompts, reuse for tool followups
		const turnKey = `${sessionInfo.sessionId}:${keyRecord.id}`;
		if (isNewPrompt) {
			const newTurnId = `turn_${generateSessionId().slice(0, 16)}`;
			turnIdCache.set(turnKey, newTurnId);
			logEntry.turnId = newTurnId;
		} else {
			// For tool followups, reuse the current turn ID
			logEntry.turnId = turnIdCache.get(turnKey) || null;
		}

		// Safety net: guarantee turn_id is never null.
		// Without a turn_id, the request is invisible to all stats queries, charts,
		// and leaderboards (they all filter on turn_id IS NOT NULL).
		if (!logEntry.turnId) {
			const fallbackTurnId = `turn_${generateSessionId().slice(0, 16)}`;
			turnIdCache.set(turnKey, fallbackTurnId);
			logEntry.turnId = fallbackTurnId;
		}

		enqueueLogWrite(async (tx) => {
			logEntry.isCountedRequest = counted ? true : false;
			logEntry.isBillableToken = isBillableToken ? true : false;
			await tx.insert(requestLogs).values(logEntry);
			logEmitter.emit({
				...logEntry,
				toolsUsed: parseToolJson(logEntry.toolsUsed),
			});

			if (counted && messageAnalysis.messageHash) {
				sessionHashCache.set(
					sessionInfo.sessionId,
					messageAnalysis.messageHash,
				);
				await tx
					.update(chatSessions)
					.set({
						lastUserMessageHash: messageAnalysis.messageHash,
						lastMessageRole: messageAnalysis.messageRole || null,
					})
					.where(eq(chatSessions.sessionId, sessionInfo.sessionId));
			}

			if (counted) {
				// Global limit tracking
				const globalWindowStr =
					keyRecord.promptLimitWindow ||
					config.globalPromptLimitWindow ||
					'30m';
				const globalWindowMs = parseRateLimitWindow(globalWindowStr);
				let globalWindowStartMs = 0;
				if (keyRecord.promptWindowStart) {
					globalWindowStartMs = Date.parse(
						keyRecord.promptWindowStart.replace(' ', 'T') + 'Z',
					);
				}

				const nowMs = Date.now();
				const nowStr = new Date()
					.toISOString()
					.replace('T', ' ')
					.substring(0, 19);

				if (
					!globalWindowStartMs ||
					nowMs >= globalWindowStartMs + globalWindowMs
				) {
					await tx
						.update(apiKeys)
						.set({ promptWindowStart: nowStr })
						.where(eq(apiKeys.id, keyRecord.id));
				}

				// Model limit tracking — use pattern-aware helper inside the tx.
				const normalizedPersistModel = await normalizeModelForLimit(model);
				const activeOverride = await findActiveOverrideInTx(tx, keyRecord.id, normalizedPersistModel);

				if (activeOverride) {
					const modelWindowStr =
						keyRecord.perModelPromptLimitWindow ||
						config.globalPerModelPromptLimitWindow ||
						'30m';
					const modelWindowMs = parseRateLimitWindow(modelWindowStr);
					let modelWindowStartMs = 0;
					if (activeOverride.promptWindowStart) {
						modelWindowStartMs = Date.parse(
							activeOverride.promptWindowStart.replace(' ', 'T') + 'Z',
						);
					}
					if (
						!modelWindowStartMs ||
						nowMs >= modelWindowStartMs + modelWindowMs
					) {
						await tx
							.update(modelLimits)
							.set({ promptWindowStart: nowStr })
							.where(eq(modelLimits.id, activeOverride.id));
					}
				}
			}

			if (shouldCountRequest && isNewPrompt) {
				await updateSessionAfterRequest(tx, {
					sessionId: sessionInfo.sessionId,
					ipAddress: clientIp,
					ideDetected: ide,
					provider,
					model,
					contextFingerprint,
					contextTokensBefore,
					requestPreview,
					totalTokens: logEntry.totalTokens || 0,
					estimatedCost: logEntry.estimatedCost || 0,
					contextEvent: sessionInfo.contextEvent,
					isNewPrompt,
					messageAnalysis,
					hasActualToolCalls,
				});
			}
		});
	};

	const baseLogEntry = {
		apiKeyId: keyRecord.id,
		apiKeyName: keyRecord.name,
		userAgentRaw: userAgent || null,
		osDetected,
		clientName: clientName || ide,
		ipAddress: clientIp,
		deviceFingerprint: fingerprint,
		ideDetected: ide,
		provider,
		endpointPath: path,
		sessionId: sessionInfo.sessionId,
		model,
		contextFingerprint: contextFingerprint || null,
		contextTokensBefore,
		contextDeltaTokens: sessionInfo.contextDeltaTokens,
		contextEvent: sessionInfo.contextEvent,
		requestPreview: requestPreview || null,
		responsePreview: null,
		transcriptSnapshot: transcriptSnapshot || null,
		estimatedContextLength: estimatedContextLength || contextTokensBefore,
	};

	// ΓöÇΓöÇΓöÇ 10. Forward Request to Upstream ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
	const upstreamHeaders: Record<string, string> = {};
	const blockedHeaders = new Set([
		'host',
		'content-length',
		'content-encoding',
		'authorization',
		'cookie',
		'connection',
		'keep-alive',
		'transfer-encoding',
		'upgrade',
	]);

	for (const [headerKey, headerValue] of c.req.raw.headers.entries()) {
		if (!blockedHeaders.has(headerKey.toLowerCase())) {
			upstreamHeaders[headerKey] = headerValue;
		}
	}

	upstreamHeaders['x-forwarded-for'] = clientIp;
	if (contentType) upstreamHeaders['Content-Type'] = contentType;

	// Detect Anthropic provider
	const isAnthropicProvider = targetProvider.endpointType === 'anthropic';
	// Detect You.com provider (agents API)
	const isYouComProvider = targetProvider.endpointType === 'youcom';
	let anthropicRequestBody: string | null = null;
	let youcomRequestBody: string | null = null;
	let youcomContext: {
		clientSentTools: boolean;
		matchedToolName: string | null;
		lastUserText: string;
	} = { clientSentTools: false, matchedToolName: null, lastUserText: '' };
	let actualUpstreamUrl = upstreamUrl;
	let actualUpstreamPath = upstreamPath;

	if (isAnthropicProvider) {
		anthropicRequestBody = prepareAnthropicUpstreamBody(requestBody);
		actualUpstreamUrl = resolveAnthropicUpstreamUrl(targetProvider.endpoint);
	} else if (isYouComProvider) {
		// Convert OpenAI request to you.com Agents format.
		// `upstreamModel` is the bare id after prefix strip (e.g. "express").
		const youcomRequest = convertRequestToYouCom(
			requestBody,
			upstreamModel,
		);

		// Tool-round-trip short-circuit: the client echoed back a cached
		// tool result. Return it directly without calling you.com again.
		if (youcomRequest.cachedAnswer) {
			const cachedResponse = buildCachedRoundTripResponse(
				model,
				youcomRequest.cachedAnswer,
			);
			const cachedBody = JSON.stringify(cachedResponse);
			if (isStreaming) {
				const sseLines = buildYouComStreamChunks(cachedResponse);
				const sseBody = sseLines.map((l) => l + '\n\n').join('');
				return new Response(sseBody, {
					status: 200,
					headers: {
						'Content-Type': 'text/event-stream; charset=utf-8',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					},
				});
			}
			return new Response(cachedBody, {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		youcomRequestBody = JSON.stringify(youcomRequest.request);

		// Stash the matching tool name + last user text for the response
		// converter so it can build a real tool_call block.
		youcomContext = {
			clientSentTools:
				Array.isArray(requestBody?.tools) &&
				(requestBody.tools as unknown[]).length > 0,
			matchedToolName: youcomRequest.matchedToolName,
			lastUserText: youcomRequest.lastUserText,
		};

		// Redirect path to /v1/agents/runs for you.com
		actualUpstreamPath = '/v1/agents/runs';
		const upstreamBase = targetProvider.endpoint.replace(/\/$/, '');
		actualUpstreamUrl = `${upstreamBase}${actualUpstreamPath}`;
	}

	try {
		let upstreamResponse!: Response;
		let usedKeyId!: number;

		let modelsToTry: string[];
		if (keyRecord.isTrial && model !== 'auto') {
			const built = await buildTrialModelsToTry(config, model);
			if ('error' in built) {
				return c.json(
					{
						error: {
							message: `Trial users may only use gpy provider models. Requested: "${model}"`,
							type: 'access_error',
							code: 'trial_model_not_allowed',
						},
					},
					403,
				);
			}
			modelsToTry = built.models;
		} else if (!keyRecord.isTrial && model !== 'auto') {
			modelsToTry = [model, 'auto'];
		} else {
			modelsToTry = [model];
		}

		let fetchSucceeded = false;
		const originalModel = model;
		// Trial users should not wait through 2 retries per model — one attempt
		// per model, then skip-ahead to __auto__ on the first failure. Phantom
		// users still get 3 attempts per model for the cost-savings case where
		// an upstream has transient hiccups.
		const maxAttemptsPerModel = keyRecord.isTrial ? 1 : 3;
		// When a model in the chain fails (upstream 5xx / network error / abort)
		// we increment this. For trial users we go to __auto__ on the first
		// failure instead of continuing to retry other gpy models — they've
		// already waited 2 minutes and we shouldn't make them wait through
		// every other upstream gpy model in the chain.
		let consecutiveNonRetryable = 0;
		const consecutiveFailuresToSkipAhead = keyRecord.isTrial ? 1 : 99;
		// Empty tool_use response counter: when an upstream returns HTTP 200
		// but the body has no message.content AND no message.tool_calls, AND
		// the request itself carried a `tools[]` array (Cline / Codex pattern),
		// the response is unusable for the caller. For trial users we skip
		// ahead to the next model on the first occurrence instead of returning
		// the empty body. This is the case where glm-5.2 / tokito repeatedly
		// returns zero-content to a Cline retry prompt and the IDE ends up
		// looping "you did not use a tool" forever.
		let consecutiveEmptyToolUse = 0;
		// Track the buffered response body of the last successful attempt so
		// downstream code (which may also re-read it for logging) can use it.
		// Only set when the body was already inspected for the empty-tool-use
		// heuristic; otherwise upstreamResponse.body is left untouched.
		let bufferedEmptyResponse: Response | null = null;

		// Skip models that are known to be offline in the last 10 minutes. This
		// prevents the trial user from waiting for a 25s timeout on each broken
		// model before we get to a healthy one. We re-include the user's
		// explicitly requested model so we still try it first even if the
		// monitor flagged it (they may have just recovered).
		const recentlyOffline = await getRecentlyOfflineGpyModelIds(originalModel, 10 * 60 * 1000);
		const filteredModelsToTry = modelsToTry.filter(
			(m) => !recentlyOffline.has(stripGpyPrefix(m)),
		);
		// Restore user's explicit request at the front even if it's flagged offline.
		const orderedModels = filteredModelsToTry;

		for (let ti = 0; ti < orderedModels.length; ti++) {
			const attemptModel = orderedModels[ti];

			for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
				let pickModel = attemptModel;
				if (pickModel === '__auto__' || pickModel === 'auto') {
					// Last-resort virtual auto. For trial users, this intentionally
					// allows non-gpy models — the idea is the user has already
					// failed through every configured gpy upstream and we want a
					// response rather than a 503. Phantom users get the full pool.
					let onlineModels = await getOnlineModelsByLatency();
					onlineModels = onlineModels.filter((m) => isAutoCompatible(m.modelId));
					if (onlineModels.length === 0) break;
					const pick = onlineModels[0];
					pickModel = pick.provider ? `${pick.provider}/${pick.modelId}` : pick.modelId;
				}

				// Trial / Phantom auto-fallback: cap each attempt at 120s so that
				// slow reasoning upstreams have time to respond before we move on.
				// The 1h default in fetchUpstreamWithRetry is for very long
				// single requests, not for a fallback chain.
				const perAttemptTimeoutMs = keyRecord.isTrial || (!keyRecord.isTrial && model !== 'auto') ? 120_000 : 0;
				let attemptSignal = c.req.raw.signal;
				let perAttemptController: AbortController | null = null;
				if (perAttemptTimeoutMs > 0) {
					perAttemptController = new AbortController();
					setTimeout(() => perAttemptController!.abort(new Error('Per-attempt timeout')), perAttemptTimeoutMs).unref?.();
					if (attemptSignal) {
						const upstreamSignal = attemptSignal;
						const handler = () => perAttemptController!.abort(upstreamSignal.reason || new Error('Client disconnected'));
						if (upstreamSignal.aborted) {
							perAttemptController.abort(upstreamSignal.reason);
						} else {
							upstreamSignal.addEventListener('abort', handler, { once: true });
						}
					}
					attemptSignal = AbortSignal.any([perAttemptController.signal, c.req.raw.signal].filter(Boolean)) as AbortSignal;
				}

				let attemptProvider = targetProvider;
				let attemptUpstreamModel = upstreamModel;
				let attemptUpstreamUrl = upstreamUrl;
				let attemptAnthropicBody = anthropicRequestBody;
				let attemptYoucomBody = youcomRequestBody;
				let attemptActualUrl =
					isAnthropicProvider || isYouComProvider ? actualUpstreamUrl : upstreamUrl;
				let attemptIsAnthropic = isAnthropicProvider;
				let attemptIsYoucom = isYouComProvider;

				if (pickModel !== originalModel) {
					const tp = await getProviderForModel(pickModel);
					if (!tp) {
						if (attemptModel === '__auto__' || attemptModel === 'auto') break;
						break;
					}
					if (keyRecord.isTrial && !isGpyProviderOrModel(tp.name, pickModel)) {
						if (attemptModel === '__auto__' || attemptModel === 'auto') break;
						break;
					}
					attemptProvider = tp;
					attemptUpstreamModel = await stripProviderPrefix(pickModel);
					if (requestBody) requestBody.model = attemptUpstreamModel;
					requestBodyBytes = new TextEncoder().encode(JSON.stringify(requestBody));
					const base = attemptProvider.endpoint.replace(/\/$/, '');
					let pathPart = forwardPath;
					if (base.endsWith('/v1') && pathPart.startsWith('/v1/')) pathPart = pathPart.slice(3);
					else if (base.endsWith('/v1') && pathPart === '/v1') pathPart = '';
					attemptUpstreamUrl = `${base}${pathPart}`;
					attemptIsAnthropic = attemptProvider.endpointType === 'anthropic';
					attemptIsYoucom = attemptProvider.endpointType === 'youcom';
					if (attemptIsAnthropic) {
						attemptAnthropicBody = prepareAnthropicUpstreamBody(requestBody);
						attemptActualUrl = resolveAnthropicUpstreamUrl(attemptProvider.endpoint);
					} else if (attemptIsYoucom) {
						const yc = convertRequestToYouCom(requestBody, attemptUpstreamModel);
						attemptYoucomBody = JSON.stringify(yc.request);
						attemptActualUrl = `${base}/v1/agents/runs`;
					} else {
						attemptActualUrl = attemptUpstreamUrl;
					}
				}

				const result = await fetchWithKeyRotation(
					attemptProvider.id,
					attemptIsAnthropic || attemptIsYoucom ? attemptActualUrl : attemptUpstreamUrl,
					(apiKey) => {
						if (attemptIsAnthropic) {
							return {
								method: c.req.method,
								headers: buildAnthropicUpstreamHeaders(apiKey, upstreamHeaders),
								body: attemptAnthropicBody!,
							};
						}

						const headers = { ...upstreamHeaders };
						if (attemptIsYoucom) {
							delete headers['content-type'];
							delete headers['accept'];
							headers['Content-Type'] = 'application/json';
							headers['Authorization'] = `Bearer ${apiKey}`;
						} else {
							headers['Authorization'] = `Bearer ${apiKey}`;
						}
						return {
							method: c.req.method,
							headers,
							body: attemptIsAnthropic
								? attemptAnthropicBody!
								: attemptIsYoucom
									? attemptYoucomBody!
									: (requestBodyBytes as any),
						};
					},
					attemptIsYoucom ? false : isStreaming,
					attemptSignal,
				);

				upstreamResponse = result.response;
				usedKeyId = result.keyId;

				if (upstreamResponse.ok) {
					// Empty tool_use detection (trial + non-streaming + has tools):
					// some upstreams (e.g. tokito/glm-5.2) return HTTP 200 with
					// choices[0].message.content empty AND no tool_calls when
					// the client pushes back with a "you did not use a tool"
					// retry message. Cline then loops forever asking for tool
					// use that the model won't produce. To prevent wasted
					// tokens and IDE stalls, treat that as a non-retryable
					// failure and skip ahead to the next model in the chain.
					const requestHasTools =
						Array.isArray(requestBody?.tools) && requestBody.tools.length > 0;
					let emptyToolUse = false;
					if (
						keyRecord.isTrial &&
						!isStreaming &&
						requestHasTools &&
						upstreamResponse.body &&
						(consecutiveEmptyToolUse === 0 || true)
					) {
						try {
							const cloned = upstreamResponse.clone();
							const bodyText = await cloned.text();
							try {
								const parsed = JSON.parse(bodyText);
								const msg = parsed?.choices?.[0]?.message;
								const hasContent =
									typeof msg?.content === 'string' && msg.content.length > 0;
								const hasToolCalls =
									Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
								if (!hasContent && !hasToolCalls) {
									emptyToolUse = true;
								}
							} catch {
								/* not JSON, treat as normal success */
							}
						} catch (err) {
							console.error(
								'[proxy] failed to peek response for empty-tool-use check:',
								(err as Error)?.message,
							);
						}
					}

					if (emptyToolUse) {
						consecutiveEmptyToolUse += 1;
						console.log(
							`[proxy] trial empty tool_use response from ${pickModel} (key ${usedKeyId}); skipping to next model`,
						);
						// Drain the unread body so the connection can be reused.
						try {
							await upstreamResponse.body?.cancel();
						} catch {
							/* ignore */
						}
						upstreamResponse = null as any;
						// Trial users skip ahead on first empty tool_use response.
						if (consecutiveEmptyToolUse >= 1) {
							// Break out of inner attempt loop and outer model loop —
							// fall through to __auto__ next iteration if available.
							break;
						}
						continue;
					}

					if (pickModel !== originalModel) {
						console.log(`[proxy] trial fallback: ${originalModel} -> ${pickModel} (key ${usedKeyId})`);
						model = pickModel;
					}
					fetchSucceeded = true;
					break;
				}
				// Status 0 means our per-attempt timeout fired. Count it as a
				// non-retryable failure for skip-ahead purposes — the user has
				// already waited 2 minutes and we shouldn't make them wait
				// through every other gpy model in the chain.
				const isAbort = upstreamResponse.status === 0;
				if (!isRetryableUpstreamStatus(upstreamResponse.status) || isAbort) {
					if (attemptModel !== '__auto__' && attemptModel !== 'auto') {
						consecutiveNonRetryable += 1;
						if (consecutiveNonRetryable >= consecutiveFailuresToSkipAhead) {
							console.log(
								`[proxy] trial ${consecutiveNonRetryable} consecutive gpy failures, skipping ahead to __auto__`,
							);
							break;
						}
					}
					break;
				}
				console.log(`[proxy] trial ${attemptModel} attempt ${attempt + 1}/${maxAttemptsPerModel} got ${upstreamResponse.status}, retrying...`);
				await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
			}

			if (fetchSucceeded) break;
			if (attemptModel === '__auto__' || attemptModel === 'auto') break;
			// Empty tool_use skip-ahead: if the previous attempt returned
			// a 200 with no content AND no tool_calls, advance to the next
			// model in the chain (or to __auto__ if this was the last
			// non-auto model) without waiting for an explicit failure.
			if (consecutiveEmptyToolUse >= 1) {
				console.log(
					`[proxy] trial empty tool_use skip-ahead: dropping ${attemptModel}, moving on`,
				);
				continue;
			}
		}

		if (!fetchSucceeded) {
			throw new Error('All upstream attempts failed');
		}

		const latencyMs = Date.now() - startTime;
		const statusCode = upstreamResponse.status;

		// ΓöÇΓöÇΓöÇ 11. Register/Update Device ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
		if (existingDevice) {
			await db
				.update(devices)
				.set({
					lastSeen: new Date(),
					requestCount: existingDevice.requestCount + 1,
					ipAddress: clientIp,
					userAgentRaw: userAgent,
					osDetected,
					deviceName: deviceName || null,
					ideDetected: ide,
				})
				.where(eq(devices.id, existingDevice.id));
		} else {
			await db.insert(devices).values({
				apiKeyId: keyRecord.id,
				fingerprint,
				ipAddress: clientIp,
				userAgentRaw: userAgent,
				osDetected,
				deviceName: deviceName || null,
				ideDetected: ide,
				requestCount: 1,
			});
		}

		// ΓöÇΓöÇΓöÇ 12. Handle Streaming Response ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
		// Note: you.com agents are non-streaming upstream; fake-streaming is
		// handled in the non-streaming path below.
		if (isStreaming && !isYouComProvider && upstreamResponse.body && statusCode < 400) {
			const acc = makeAccumulator();
			let hasActualToolCalls = false;
			const decoder = new TextDecoder();
			const anthropicStreamState = isAnthropicProvider
				? createStreamState(model)
				: null;
			const clientAnthropicStreamState = isAnthropicRequest
				? createAnthropicStreamState(model)
				: null;
			let anthropicBuffer = '';
			let responsesBuffer = ''; // for Responses API SSE conversion
			let responsesResponseId = `resp-${Date.now()}`;
			let responsesSentCreated = false;

			const { readable, writable } = new TransformStream({
				transform(chunk, controller) {
					if (isAnthropicProvider && anthropicStreamState) {
						// Anthropic streaming: convert SSE events to OpenAI format
						anthropicBuffer += decoder.decode(chunk, { stream: true });
						const events = anthropicBuffer.split('\n\n');
						anthropicBuffer = events.pop() || ''; // Keep incomplete event in buffer

						for (const event of events) {
							const openaiLines = convertStreamEvent(
								event,
								anthropicStreamState,
							);
							for (const line of openaiLines) {
								const encoded = new TextEncoder().encode(line + '\n\n');
								controller.enqueue(encoded);

								// Also accumulate for logging
								if (line.startsWith('data: ') && line !== 'data: [DONE]') {
									try {
										const data = JSON.parse(line.slice(6));
										appendToolsFromPayload(data);
										if (detectToolCallsInResponse(data))
											hasActualToolCalls = true;
										consumeStreamPayload(acc, data);
									} catch {}
								}
							}
						}
					} else if (isResponsesApi) {
						// Responses API streaming: convert Chat Completions SSE to Responses API SSE
						responsesBuffer += decoder.decode(chunk, { stream: true });
						const lines = responsesBuffer.split('\n');
						responsesBuffer = lines.pop() || '';

						for (const line of lines) {
							if (!line.startsWith('data: ') || line === 'data: [DONE]') {
								if (line === 'data: [DONE]') {
									// Send response.completed event
									const completedEvent = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: responsesResponseId, object: 'response', status: 'completed' } })}\n\n`;
									controller.enqueue(new TextEncoder().encode(completedEvent));
								}
								continue;
							}

							const payloadText = line.slice(6).trim();
							if (!payloadText) continue;

							try {
								const data = JSON.parse(payloadText);
								appendToolsFromPayload(data);
								if (detectToolCallsInResponse(data)) hasActualToolCalls = true;
								consumeStreamPayload(acc, data);

								// Send response.created on first chunk
								if (!responsesSentCreated) {
									responsesSentCreated = true;
									responsesResponseId =
										data.id?.replace('chatcmpl', 'resp') || responsesResponseId;
									const createdEvent = `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: responsesResponseId, object: 'response', status: 'in_progress' } })}\n\n`;
									controller.enqueue(new TextEncoder().encode(createdEvent));
								}

								// Convert delta to Responses API format
								const delta = data.choices?.[0]?.delta;
								if (delta?.content) {
									const deltaEvent = `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', item_id: `msg-${Date.now()}`, output_index: 0, content_index: 0, delta: delta.content })}\n\n`;
									controller.enqueue(new TextEncoder().encode(deltaEvent));
								}
							} catch {}
						}
					} else if (isAnthropicRequest && clientAnthropicStreamState) {
						// Anthropic SSE streaming: convert OpenAI chunks → Anthropic events
						// (do NOT pass through the original OpenAI chunks — only emit the converted Anthropic events)
						try {
							const text = decoder.decode(chunk, { stream: true });
							const lines = text.split('\n');
							for (const line of lines) {
								if (!line.startsWith('data:')) continue;
								const payloadText = line.slice(5).trim();
								if (payloadText === '[DONE]') {
									const flushed = flushAnthropicStream(clientAnthropicStreamState);
									if (flushed) controller.enqueue(new TextEncoder().encode(flushed));
									continue;
								}
								if (!payloadText) continue;
								try {
									const data = JSON.parse(payloadText);
									appendToolsFromPayload(data);
									if (detectToolCallsInResponse(data)) hasActualToolCalls = true;
									consumeStreamPayload(acc, data);
									const converted = convertOpenAIChunkToAnthropicEvents(line, clientAnthropicStreamState);
									if (converted) {
										controller.enqueue(new TextEncoder().encode(converted));
									}
								} catch {}
							}
						} catch {}
					} else {
						// OpenAI streaming: pass through as-is
						controller.enqueue(chunk);
						try {
							const text = decoder.decode(chunk, { stream: true });
							const lines = text.split('\n');
							for (const line of lines) {
								if (line.startsWith('data: ') && line !== 'data: [DONE]') {
									const payloadText = line.slice(6).trim();
									if (!payloadText || payloadText === '[DONE]') continue;
									try {
										const data = JSON.parse(payloadText);
										appendToolsFromPayload(data);
										if (detectToolCallsInResponse(data))
											hasActualToolCalls = true;
										consumeStreamPayload(acc, data);
									} catch {}
								}
							}
						} catch {}
					}
				},
				flush() {
					const finalized = finalizeCompletion(acc);
					// Inlined: finalizeCountedCompletion was never exported from token-extractor.ts
					const rawCompletionTokens = finalized.completionTokens
						? finalized.completionTokens
						: finalized.completionText
							? Math.max(estimateTokens(finalized.completionText), 1)
							: 0;
					const billableTokens = resolveBillableTokens(
						{
							promptTokens: finalized.promptTokens,
							completionTokens: rawCompletionTokens,
							cachedTokens: finalized.cachedTokens,
						},
						sessionInfo.contextDeltaTokens,
						fullLastUserTurnText,
					);
					const toolsUsed = Array.from(toolNameSet);

					const logEntry = {
						...baseLogEntry,
						promptTokens: billableTokens.promptTokens,
						completionTokens: billableTokens.completionTokens,
						totalTokens: billableTokens.totalTokens,
						cachedTokens: billableTokens.cachedTokens,
						toolCount: toolsUsed.length,
						hasToolCalls: toolsUsed.length > 0,
						toolsUsed: toToolJson(toolsUsed),
						responsePreview: finalized.completionText || null,
						latencyMs: Date.now() - startTime,
						statusCode,
						estimatedCost: calculateEstimatedCost(
							model,
							billableTokens.promptTokens,
							billableTokens.completionTokens,
						),
						messageRole: messageAnalysis.messageRole,
						userMessageHash: messageAnalysis.messageHash,
						actualToolCallsInResponse: hasActualToolCalls,
					};

					// Only count request if status is 2xx (success)
					const shouldCountRequest = statusCode >= 200 && statusCode < 300;
					persistLogAndSession(
						logEntry,
						hasActualToolCalls,
						shouldCountRequest,
					);
				},
			});

			upstreamResponse.body.pipeTo(writable).catch((err) => {
				console.error('[proxy-stream] pipeTo error:', err?.message || err);
			});

			const responseHeaders: Record<string, string> = {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			};

			const copyHeaders = [
				'x-request-id',
				'openai-organization',
				'openai-processing-ms',
			];
			for (const h of copyHeaders) {
				const val = upstreamResponse.headers.get(h);
				if (val) responseHeaders[h] = val;
			}

			const rateLimitLimit = (c as any).get(
				'x-ratelimit-limit-requests',
			) as string;
			const rateLimitRemaining = (c as any).get(
				'x-ratelimit-remaining-requests',
			) as string;
			if (rateLimitLimit)
				responseHeaders['x-ratelimit-limit-requests'] = rateLimitLimit;
			if (rateLimitRemaining)
				responseHeaders['x-ratelimit-remaining-requests'] = rateLimitRemaining;

			return new Response(readable, {
				status: statusCode,
				headers: responseHeaders,
			});
		}

		// ΓöÇΓöÇΓöÇ 13. Handle Non-Streaming Response ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
		let responseBody = await upstreamResponse.text();
		let promptTokens = 0;
		let completionTokens = 0;
		let totalTokens = 0;
		let errorMessage: string | undefined;
		let responsePreview: string | null = null;
		let hasActualToolCalls = false;
		let finalizedUsage: any = {};
		const acc = makeAccumulator();

		// Convert Anthropic response to OpenAI format
		if (isAnthropicProvider && statusCode >= 200 && statusCode < 300) {
			try {
				const anthropicParsed = JSON.parse(responseBody);
				const openaiResponse = convertResponseToOpenAI(anthropicParsed);
				responseBody = JSON.stringify(openaiResponse);
			} catch (convErr) {
				console.error(
					'[anthropic-adapter] Failed to convert response:',
					convErr,
				);
			}
		}

		// Convert you.com Agents response to OpenAI format
		if (isYouComProvider && statusCode >= 200 && statusCode < 300) {
			try {
				const youParsed = JSON.parse(responseBody);
				const conversion = convertResponseToYouComOpenAI(
					youParsed,
					model,
					{
						clientSentTools: youcomContext.clientSentTools,
						matchedToolName: youcomContext.matchedToolName,
						lastUserText: youcomContext.lastUserText,
					},
				);
				responseBody = JSON.stringify(conversion.openaiResponse);
			} catch (convErr) {
				console.error(
					'[youcom-adapter] Failed to convert response:',
					convErr,
				);
			}
		}

		// Convert Chat Completions response to Responses API format if needed
		if (isResponsesApi && statusCode >= 200 && statusCode < 300) {
			try {
				const chatParsed = JSON.parse(responseBody);
				const responsesOutput: any[] = [];

				if (chatParsed.choices && chatParsed.choices.length > 0) {
					const choice = chatParsed.choices[0];
					const contentBlocks: any[] = [];

					if (choice.message?.content) {
						contentBlocks.push({
							type: 'output_text',
							text: choice.message.content,
						});
					}

					if (choice.message?.tool_calls) {
						for (const tc of choice.message.tool_calls) {
							contentBlocks.push({
								type: 'tool_call',
								id: tc.id,
								name: tc.function?.name,
								arguments: tc.function?.arguments,
							});
						}
					}

					responsesOutput.push({
						type: 'message',
						role: 'assistant',
						content: contentBlocks,
						status:
							choice.finish_reason === 'stop' ? 'completed' : 'incomplete',
					});
				}

				const responsesBody = {
					id:
						chatParsed.id?.replace('chatcmpl', 'resp') || `resp-${Date.now()}`,
					object: 'response',
					created: chatParsed.created || Math.floor(Date.now() / 1000),
					model: chatParsed.model || model,
					output: responsesOutput,
					usage: chatParsed.usage || null,
					status: 'completed',
				};
				responseBody = JSON.stringify(responsesBody);
			} catch (convErr) {
				console.error(
					'[responses-adapter] Failed to convert response:',
					convErr,
				);
			}
		}

		// Convert OpenAI Chat Completions response to Anthropic Messages format
		if (isAnthropicRequest && statusCode >= 200 && statusCode < 300) {
			try {
				const openaiParsed = JSON.parse(responseBody);
				const anthropicResp = convertOpenAIToAnthropicResponse(openaiParsed);
				responseBody = JSON.stringify(anthropicResp);
			} catch (convErr) {
				console.error(
					'[anthropic-adapter] Failed to convert response:',
					convErr,
				);
			}
		}

		try {
			const parsed = JSON.parse(responseBody);
			appendToolsFromPayload(parsed);

			// Detect actual tool calls in response
			hasActualToolCalls = detectToolCallsInResponse(parsed);

			if (parsed.error) {
				errorMessage = parsed.error.message || JSON.stringify(parsed.error);
			}

			consumeNonStreamingPayload(acc, parsed);
			const finalized = finalizeCompletion(acc);
			finalizedUsage = finalized;
			completionTokens = finalized.completionTokens
				? finalized.completionTokens
				: finalized.completionText
					? Math.max(estimateTokens(finalized.completionText), 1)
					: 0;
			responsePreview = finalized.completionText || null;

			if (!completionTokens && !responsePreview && responseBody.length > 200) {
				completionTokens = Math.max(estimateTokens(responseBody), 1);
			}
		} catch {
			// Body might not be JSON — try to recover from SSE-style error bodies
			// (some upstreams return `data:{"error":...}\n\n` instead of plain JSON)
			if (statusCode >= 400 && responseBody) {
				const sseMatch = /^data:\s*(\{.*?\})\s*(?:\n\n|$)/s.exec(responseBody.trim());
				if (sseMatch) {
					try {
						const parsed = JSON.parse(sseMatch[1]);
						if (parsed?.error) {
							const errMsg = parsed.error.message || JSON.stringify(parsed.error);
							const errParam = parsed.error.param ? ` (param: ${parsed.error.param})` : "";
							errorMessage = errMsg + errParam;
						}
					} catch {}
				}
				if (!errorMessage) {
					errorMessage = responseBody.slice(0, 500);
				}
				console.warn(`[proxy] Upstream ${statusCode} for model "${model}": ${errorMessage.slice(0, 200)}`);
			}
		}

		const billableTokens = resolveBillableTokens(
			{
				promptTokens: finalizedUsage.promptTokens,
				completionTokens,
				cachedTokens: finalizedUsage.cachedTokens,
			},
			sessionInfo.contextDeltaTokens,
			fullLastUserTurnText,
		);
		promptTokens = billableTokens.promptTokens;
		completionTokens = billableTokens.completionTokens;
		totalTokens = billableTokens.totalTokens;
		const cachedTokens = billableTokens.cachedTokens;

		const toolsUsed = Array.from(toolNameSet);

		const logEntry = {
			...baseLogEntry,
			promptTokens,
			completionTokens,
			totalTokens,
			cachedTokens,
			toolCount: toolsUsed.length,
			hasToolCalls: toolsUsed.length > 0,
			toolsUsed: toToolJson(toolsUsed),
			responsePreview,
			latencyMs,
			statusCode,
			errorMessage,
			estimatedCost: calculateEstimatedCost(
				model,
				promptTokens,
				completionTokens,
			),
			messageRole: messageAnalysis.messageRole,
			userMessageHash: messageAnalysis.messageHash,
			actualToolCallsInResponse: hasActualToolCalls,
		};

		// Only count request if status is 2xx (success)
		const shouldCountRequest = statusCode >= 200 && statusCode < 300;
		persistLogAndSession(logEntry, hasActualToolCalls, shouldCountRequest);

		const responseHeaders: Record<string, string> = {
			'Content-Type':
				upstreamResponse.headers.get('Content-Type') || 'application/json',
		};

		const copyHeaders = [
			'x-request-id',
			'openai-organization',
			'openai-processing-ms',
			'x-ratelimit-limit-tokens',
			'x-ratelimit-remaining-tokens',
		];
		for (const h of copyHeaders) {
			const val = upstreamResponse.headers.get(h);
			if (val) responseHeaders[h] = val;
		}

		// We override upstream request limits with our proxy limits
		const rateLimitLimit = (c as any).get(
			'x-ratelimit-limit-requests',
		) as string;
		const rateLimitRemaining = (c as any).get(
			'x-ratelimit-remaining-requests',
		) as string;
		if (rateLimitLimit)
			responseHeaders['x-ratelimit-limit-requests'] = rateLimitLimit;
		if (rateLimitRemaining)
			responseHeaders['x-ratelimit-remaining-requests'] = rateLimitRemaining;

		// you.com fake-streaming: client asked for stream:true but the agents API
		// is non-streaming. Emit the converted answer as a short SSE sequence.
		if (
			isYouComProvider &&
			isStreaming &&
			statusCode >= 200 &&
			statusCode < 300
		) {
			try {
				const openaiParsed = JSON.parse(responseBody);
				const sseLines = buildYouComStreamChunks(openaiParsed);
				const sseBody = sseLines.map((l) => l + '\n\n').join('');
				return new Response(sseBody, {
					status: statusCode,
					headers: {
						...responseHeaders,
						'Content-Type': 'text/event-stream; charset=utf-8',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					},
				});
			} catch (streamErr) {
				console.error(
					'[youcom-adapter] Failed to build stream chunks:',
					streamErr,
				);
			}
		}

		return new Response(responseBody, {
			status: statusCode,
			headers: responseHeaders,
		});
	} catch (error: any) {
		const latencyMs = Date.now() - startTime;
		const errorMessage = error?.message || 'Upstream request failed';
		const toolsUsed = Array.from(toolNameSet);

		const logEntry = {
			...baseLogEntry,
			promptTokens: contextTokensBefore,
			completionTokens: 0,
			totalTokens: contextTokensBefore,
			toolCount: toolsUsed.length,
			hasToolCalls: toolsUsed.length > 0,
			toolsUsed: toToolJson(toolsUsed),
			responsePreview: null,
			latencyMs,
			statusCode: 502,
			errorMessage,
			estimatedCost: calculateEstimatedCost(model, contextTokensBefore, 0),
			messageRole: messageAnalysis.messageRole,
			userMessageHash: messageAnalysis.messageHash,
			actualToolCallsInResponse: false,
		};

		// Don't count failed requests (502 = upstream error)
		persistLogAndSession(logEntry, false, false);

		return c.json(
			{
				error: {
					message: `Upstream error: ${errorMessage}`,
					type: 'upstream_error',
				},
			},
			502,
		);
	}
});

export default proxy;
