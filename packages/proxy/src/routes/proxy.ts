import { Hono } from "hono";
import { db } from "../db/index.js";
import { apiKeys, devices, allowedDevices, allowedIdes, requestLogs, adminConfig, chatSessions } from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { generateFingerprint, generateSessionId, generateApiKey, getKeyPrefix, sha256 } from "../utils/crypto.js";
import { detectIde, estimateTokens, getClientIp, normalizeIdeName } from "../utils/detect-ide.js";
import { calculateEstimatedCost } from "../utils/cost-calculator.js";
import {
  detectProvider,
  detectOperatingSystem,
  extractContextInfo,
  extractToolNamesFromPayload,
  formatSqliteDate,
  parseToolJson,
  toToolJson,
} from "../utils/telemetry.js";
import { logEmitter } from "../utils/event-emitter.js";
import { getModelCatalogResponse } from "../utils/model-catalog.js";
import { checkPromptLimit, checkModelPromptLimit, parseRateLimitWindow, getWindowResetMs } from "../utils/rate-limit.js";
import { analyzeRequestMessages, isTitleGenRequest, detectToolCallsInResponse, type MessageAnalysis } from "../utils/message-analyzer.js";

const proxy = new Hono();

type ContextEvent = "new_session" | "append" | "compact" | "switch";

// In-memory cache of the last user message hash per session.
const sessionHashCache = new Map<string, string>();

// Per-device mutex to serialize session resolution.
// Without this, concurrent requests from the same device can both read "no session"
// and each create their own session, causing duplicates and miscounts.
const deviceLocks = new Map<string, Promise<void>>();
async function withDeviceLock<T>(deviceKey: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing lock on this device to release
  while (deviceLocks.has(deviceKey)) {
    await deviceLocks.get(deviceKey);
  }
  // Create our lock
  let resolve: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
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
 * The name is trimmed to ≤72 chars so it fits in the UI comfortably.
 */
function deriveSessionName(requestBody: any, requestPreview: string): string {
  const MAX = 72;

  function truncate(s: string): string {
    const cleaned = s.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    return cleaned.length > MAX ? cleaned.slice(0, MAX - 1) + "…" : cleaned;
  }

  function extractText(value: any): string {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map(extractText).filter(Boolean).join(" ");
    }
    if (typeof value === "object") {
      return (
        extractText(value.text) ||
        extractText(value.content) ||
        extractText(value.input_text) ||
        ""
      );
    }
    return "";
  }

  if (Array.isArray(requestBody?.messages)) {
    // Priority 1: first user message
    const firstUser = requestBody.messages.find(
      (m: any) => String(m?.role || "").toLowerCase() === "user"
    );
    if (firstUser) {
      const text = truncate(extractText(firstUser?.content ?? firstUser?.text ?? firstUser));
      if (text) return text;
    }

    // Priority 2: system message snippet
    const sys = requestBody.messages.find(
      (m: any) => String(m?.role || "").toLowerCase() === "system"
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

  return "Untitled Chat";
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
const UPSTREAM_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour to support long reasoning models
const UPSTREAM_MAX_ATTEMPTS = 2;
const UPSTREAM_RETRY_BACKOFF_MS = 450;

const logWriteQueue: Array<(tx: any) => Promise<void>> = [];
let logWriteRunning = false;
let droppedLogWrites = 0;

function enqueueLogWrite(task: (tx: any) => Promise<void>) {
  if (logWriteQueue.length >= MAX_LOG_WRITE_QUEUE_SIZE) {
    logWriteQueue.shift();
    droppedLogWrites += 1;
    if (droppedLogWrites % 100 === 1) {
      console.warn(`[proxy-log-writer] queue overflow, dropped jobs: ${droppedLogWrites}`);
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
      console.error("[proxy-log-writer] batch transaction failed, falling back to sequential:", error);
      for (const task of batch) {
        try {
          await task(db);
        } catch (err) {
          console.error("[proxy-log-writer] failed to write individual log:", err);
        }
      }
    }
  }

  logWriteRunning = false;
}

function parseDbDate(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(code: number): boolean {
  return code === 429 || code === 500 || code === 502 || code === 503 || code === 504 || code === 524;
}

function isRetryableFetchError(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused")
  );
}

async function fetchUpstreamWithRetry(url: string, init: RequestInit, isStreaming: boolean, clientSignal?: AbortSignal): Promise<Response> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt++) {
    try {
      // Combine client abort signal with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error("Timeout")), UPSTREAM_TIMEOUT_MS);
      
      const abortHandler = () => {
        controller.abort(clientSignal?.reason || new Error("Client disconnected"));
      };
      
      if (clientSignal) {
        if (clientSignal.aborted) {
          throw new Error("Client already disconnected");
        }
        clientSignal.addEventListener("abort", abortHandler);
      }

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      if (clientSignal) {
        clientSignal.removeEventListener("abort", abortHandler);
      }

      if (!isStreaming && attempt < UPSTREAM_MAX_ATTEMPTS && isRetryableStatus(response.status)) {
        try { await response.body?.cancel(); } catch {}
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

  throw lastError || new Error("Upstream request failed");
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
  const now = formatSqliteDate();
  const sessionName = deriveSessionName(params.requestBody, params.requestPreview);
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
  }).run();
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
}): Promise<{ sessionId: string; contextEvent: ContextEvent; contextDeltaTokens: number; gapMs: number; isNewUserPrompt: boolean }> {
  // ─── Find the most recent session for this device ───────────────────────────
  const latest = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.apiKeyId, params.apiKeyId), eq(chatSessions.deviceFingerprint, params.deviceFingerprint)))
    .orderBy(desc(chatSessions.lastSeenAt))
    .limit(1)
    .get();

  // Also look for any very recent session from this device (within sub-agent window)
  // to handle async race conditions where row N+1 arrives before row N's session is committed
  const recentCutoff = new Date(Date.now() - SWITCH_PROMPT_MIN_GAP_MS).toISOString().replace("T", " ").substring(0, 19);
  const veryRecent = await db
    .select()
    .from(chatSessions)
    .where(and(
      eq(chatSessions.apiKeyId, params.apiKeyId),
      eq(chatSessions.deviceFingerprint, params.deviceFingerprint),
      sql`last_seen_at >= ${recentCutoff}`
    ))
    .orderBy(desc(chatSessions.lastSeenAt))
    .limit(1)
    .get();

  // ─── No session yet → create first one ──────────────────────────────────────
  if (!latest) {
    const isNewUserPrompt = params.messageAnalysis.hasUserMessage;
    const sessionId = await createChatSession({ ...params, isUserPrompt: isNewUserPrompt, messageAnalysis: params.messageAnalysis });
    return { sessionId, contextEvent: "new_session", contextDeltaTokens: 0, gapMs: Infinity, isNewUserPrompt };
  }

  const gapMs = Date.now() - parseDbDate(latest.lastSeenAt);

  // Sub-agent race condition: latest is stale but there's a very recent different session
  if (gapMs > SESSION_GAP_MS && veryRecent && veryRecent.sessionId !== latest.sessionId) {
    const veryRecentGap = Date.now() - parseDbDate(veryRecent.lastSeenAt);
    return { sessionId: veryRecent.sessionId, contextEvent: "switch", contextDeltaTokens: 0, gapMs: veryRecentGap, isNewUserPrompt: false };
  }

  // ─── Gap > 45 min → definitely a new session ────────────────────────────────
  if (gapMs > SESSION_GAP_MS) {
    const isNewUserPrompt = params.messageAnalysis.hasUserMessage;
    const sessionId = await createChatSession({ ...params, isUserPrompt: isNewUserPrompt, messageAnalysis: params.messageAnalysis });
    return { sessionId, contextEvent: "new_session", contextDeltaTokens: 0, gapMs, isNewUserPrompt };
  }

  // ─── Within session window: determine new-chat vs continuation ──────────────
  //
  // Reliable signals for detecting new chat:
  //   1. Context size shrink (history wiped) + hash changed → new chat
  //   2. No assistant messages in context (fresh chat with only system + 1 user msg) + hash changed → new chat
  //   3. Internal IDE requests (title gen) → never a new prompt, never a new session
  //   4. Same hash, short gap → IDE retry / sub-agent → same session

  const prevTokens = latest.lastContextTokens || 0;
  const incomingTokens = params.contextTokensBefore;
  
  // Use in-memory hash cache (single source of truth, immune to async DB lag).
  // Fall back to DB value only if cache is empty (e.g. server restart).
  const cachedHash = sessionHashCache.get(latest.sessionId) || latest.lastUserMessageHash || "";
  const hashChanged = !!(
    params.messageAnalysis.messageHash &&
    params.messageAnalysis.messageHash !== cachedHash
  );

  // ── Detect "New Chat" button pressed ────────────────────────────────────────
  // Method 1: Context size dropped dramatically (history wiped)
  const contextResetToZero = incomingTokens <= 0 && prevTokens > 0;
  const contextShrankMassively =
    prevTokens > 200 && incomingTokens < prevTokens * 0.4 && incomingTokens <= 200;

  if ((contextResetToZero || contextShrankMassively) && hashChanged) {
    const isNewUserPrompt = params.messageAnalysis.hasUserMessage;
    const sessionId = await createChatSession({ ...params, isUserPrompt: isNewUserPrompt, messageAnalysis: params.messageAnalysis });
    return { sessionId, contextEvent: "new_session", contextDeltaTokens: 0, gapMs, isNewUserPrompt };
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
    const sessionId = await createChatSession({ ...params, isUserPrompt: isNewUserPrompt, messageAnalysis: params.messageAnalysis });
    return { sessionId, contextEvent: "new_session", contextDeltaTokens: 0, gapMs, isNewUserPrompt };
  }

  // ── Same session continuation (model change, context growth, or sub-agent) ──
  const delta = incomingTokens - prevTokens;
  const contextEvent: ContextEvent = delta <= -COMPACT_DROP_THRESHOLD ? "compact" : "append";

  // ─── Determine if this is a new user prompt ──────────────────────────────────
  //
  // The ONLY question: did the user type a new message that deserves to be counted?
  //
  // Rules (in order):
  //   1. Not a user message → never counted
  //   2. Hash changed AND has assistant history in context → ALWAYS counted
  //      (user typed something new in an existing conversation)
  //   3. Hash changed AND no assistant history → counted ONLY if context has tools
  //      (IDE sends 2 requests: first compact without tools/history, then full.
  //       The full one has tools. The compact one is just IDE setup, skip it.)
  //   4. Hash same AND has assistant history → not counted (IDE retry/sub-agent)
  //   5. Hash same AND no assistant history AND no tools → not counted (IDE compact retry)
  //
  // This is simple and doesn't depend on gap timing or lastToolCallsActive (which
  // suffers from async write race conditions).
  let isNewUserPrompt = false;

  if (params.messageAnalysis.hasUserMessage && hashChanged) {
    // User typed something new. Count it if this is the "real" request
    // (the one with assistant history or tools), not the IDE compact setup request.
    if (params.messageAnalysis.assistantMessageCount > 0) {
      // Has conversation history → this is a continuation prompt. Always count.
      isNewUserPrompt = true;
    } else if (params.contextTokensBefore > 50) {
      // No assistant history but not a tiny ping. Count it.
      isNewUserPrompt = true;
    }
    // else: no history, extremely small context (<50 tokens) = IDE compact setup request. Don't count.
  } else if (params.messageAnalysis.hasUserMessage && !hashChanged && gapMs >= SWITCH_PROMPT_MIN_GAP_MS) {
    // Same hash but very large gap → user re-sent after long pause
    isNewUserPrompt = true;
  }

  // FALLBACK PROTEKSI: Jika hash tidak berubah (tool loops) tapi promptCount sesi masih 0
  // (karena lolos dari aturan ping sebelumnya), paksa hitung sebagai prompt baru agar limit terpotong!
  if (!isNewUserPrompt && latest && latest.promptCount === 0 && params.contextTokensBefore > 500) {
    isNewUserPrompt = true;
  }

  return { sessionId: latest.sessionId, contextEvent, contextDeltaTokens: delta, gapMs, isNewUserPrompt };
}

async function updateSessionAfterRequest(tx: any, params: {
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
}) {
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
    totalTokens: sql`${chatSessions.totalTokens} + ${Math.max(params.totalTokens || 0, 0)}`,
    estimatedCost: sql`${chatSessions.estimatedCost} + ${Math.max(params.estimatedCost || 0, 0)}`,
    lastToolCallsActive: params.hasActualToolCalls,
  };

  // Only increment requestCount and promptCount when this is a genuine new user prompt
  if (params.isNewPrompt) {
    updates.requestCount = sql`${chatSessions.requestCount} + 1`;
    updates.promptCount = sql`${chatSessions.promptCount} + 1`;
  }

  if (params.contextEvent === "compact") {
    updates.compactCount = sql`${chatSessions.compactCount} + 1`;
  }

  if (params.contextEvent === "switch") {
    updates.switchCount = sql`${chatSessions.switchCount} + 1`;
  }

  await tx.update(chatSessions).set(updates).where(eq(chatSessions.sessionId, params.sessionId)).run();
}

/**
 * Catch-all proxy handler for /v1/*
 * Forwards requests to the configured upstream AI API endpoint
 */
proxy.all("/*", async (c) => {
  const startTime = Date.now();
  const path = c.req.path; // e.g., /v1/chat/completions
  const normalizedPath = path.replace(/\/+$/, "") || "/";

  // Public model discovery endpoints from local cache.
  if ((c.req.method === "GET" || c.req.method === "HEAD") && (normalizedPath === "/v1" || normalizedPath === "/v1/models")) {
    const modelCatalog = await getModelCatalogResponse();
    if (c.req.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return c.json(modelCatalog);
  }

  // ─── 1. Extract API Key ──────────────────────────────────────────────────
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      { error: { message: "Missing or invalid Authorization header. Use: Bearer <api_key>", type: "auth_error" } },
      401
    );
  }
  const clientKey = authHeader.replace("Bearer ", "").trim();

  // ─── 2. Validate API Key ────────────────────────────────────────────────
  const keyRecord = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.key, clientKey))
    .get();

  if (!keyRecord) {
    return c.json(
      { error: { message: "Invalid API key.", type: "auth_error" } },
      401
    );
  }

  if (!keyRecord.isActive) {
    return c.json(
      { error: { message: "API key is disabled.", type: "auth_error" } },
      403
    );
  }

  // ─── 3. Device Fingerprinting & IDE Detection ───────────────────────────
  const userAgent = c.req.header("User-Agent") || "";
  const platformHintRaw = c.req.header("sec-ch-ua-platform") || "";
  const deviceName = c.req.header("x-device-name") || c.req.header("x-machine-name") || "";
  const clientName = c.req.header("x-client-name") || c.req.header("x-app-name") || "";
  const deviceId = c.req.header("x-device-id") || c.req.header("device-id") || c.req.header("x-machine-id") || "";
  const clientIp = getClientIp(c.req.raw.headers, c.req.header("x-real-ip") || "127.0.0.1");
  const fingerprint = generateFingerprint(clientIp, userAgent, deviceId);
  const ide = detectIde(userAgent);
  const platformHint = platformHintRaw + " " + deviceName;
  const osDetected = detectOperatingSystem(userAgent, platformHint);
  const normalizedIde = normalizeIdeName(ide);

  // ─── 4. Device Policy Check ─────────────────────────────────────────────
  const existingDevice = await db
    .select()
    .from(devices)
    .where(and(eq(devices.apiKeyId, keyRecord.id), eq(devices.fingerprint, fingerprint)))
    .get();

  if (existingDevice?.isBlocked) {
    return c.json(
      { error: { message: "This device has been blocked.", type: "access_error" } },
      403
    );
  }

  if (keyRecord.devicePolicy === "allowlist") {
    const allowed = await db
      .select()
      .from(allowedDevices)
      .where(
        and(
          eq(allowedDevices.apiKeyId, keyRecord.id),
          eq(allowedDevices.fingerprint, fingerprint),
          eq(allowedDevices.listType, "allow")
        )
      )
      .get();
    if (!allowed) {
      return c.json({ error: { message: "Device not in allowlist.", type: "access_error" } }, 403);
    }
  } else if (keyRecord.devicePolicy === "blacklist") {
    const blocked = await db
      .select()
      .from(allowedDevices)
      .where(
        and(
          eq(allowedDevices.apiKeyId, keyRecord.id),
          eq(allowedDevices.fingerprint, fingerprint),
          eq(allowedDevices.listType, "block")
        )
      )
      .get();
    if (blocked) {
      return c.json({ error: { message: "Device is blacklisted.", type: "access_error" } }, 403);
    }
  }

  // ─── 4b. IDE Policy Check ──────────────────────────────────────────────
  if (keyRecord.idePolicy === "allowlist") {
    const allowedIde = await db
      .select()
      .from(allowedIdes)
      .where(
        and(
          eq(allowedIdes.apiKeyId, keyRecord.id),
          eq(allowedIdes.ideName, normalizedIde),
          eq(allowedIdes.listType, "allow")
        )
      )
      .get();
    if (!allowedIde) {
      return c.json({ error: { message: `IDE '${ide}' not in allowlist.`, type: "access_error" } }, 403);
    }
  } else if (keyRecord.idePolicy === "blacklist") {
    const blockedIde = await db
      .select()
      .from(allowedIdes)
      .where(
        and(
          eq(allowedIdes.apiKeyId, keyRecord.id),
          eq(allowedIdes.ideName, normalizedIde),
          eq(allowedIdes.listType, "block")
        )
      )
      .get();
    if (blockedIde) {
      return c.json({ error: { message: `IDE '${ide}' is blacklisted.`, type: "access_error" } }, 403);
    }
  }

  // ─── 5. IP Policy Check ─────────────────────────────────────────────────
  if (keyRecord.ipPolicy === "allowlist") {
    const allowed = await db
      .select().from(allowedDevices)
      .where(and(eq(allowedDevices.apiKeyId, keyRecord.id), eq(allowedDevices.ipAddress, clientIp), eq(allowedDevices.listType, "allow")))
      .get();
    if (!allowed) {
      return c.json({ error: { message: "IP address not in allowlist.", type: "access_error" } }, 403);
    }
  } else if (keyRecord.ipPolicy === "blacklist") {
    const blocked = await db
      .select().from(allowedDevices)
      .where(and(eq(allowedDevices.apiKeyId, keyRecord.id), eq(allowedDevices.ipAddress, clientIp), eq(allowedDevices.listType, "block")))
      .get();
    if (blocked) {
      return c.json({ error: { message: "IP address is blacklisted.", type: "access_error" } }, 403);
    }
  }

  // ─── 6. Max Devices Check ───────────────────────────────────────────────
  if (keyRecord.maxDevices && keyRecord.maxDevices > 0) {
    const deviceCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(devices)
      .where(and(eq(devices.apiKeyId, keyRecord.id), eq(devices.isBlocked, false)))
      .get();

    if (deviceCount && deviceCount.count >= keyRecord.maxDevices && !existingDevice) {
      if (keyRecord.provisionedBy === "discord-bot" && keyRecord.maxDevices === 1) {
        // Generate a fresh active key, remove old device, queue DM+thread notification
        const rotatedKey = generateApiKey();
        const newKeyPrefix = getKeyPrefix(rotatedKey);

        // Remove all old devices for this key so the new device can register cleanly
        await db.delete(devices).where(eq(devices.apiKeyId, keyRecord.id)).run();

        // Update the key to the new value (stays active)
        await db.update(apiKeys).set({
          key: rotatedKey,
          keyPrefix: newKeyPrefix,
          keyHash: sha256(rotatedKey),
          isActive: true,
          updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
        }).where(eq(apiKeys.id, keyRecord.id)).run();

        // Store pending notification for bot to pick up and send
        const proxyEndpoint = `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`;
        const notification = {
          type: "new_device_detected",
          discordUserId: keyRecord.discordUserId,
          newKey: rotatedKey,
          endpoint: proxyEndpoint,
        };
        await db.update(apiKeys).set({
          pendingNotification: JSON.stringify(notification),
        }).where(eq(apiKeys.id, keyRecord.id)).run();

        return c.json(
          {
            error: {
              message: "New device detected. Your API key has been rotated automatically. Please check your Discord DMs for your new key. Only 1 device is allowed per key.",
              type: "access_error",
              code: "discord_new_device_key_rotated",
            },
          },
          403
        );
      }

      return c.json(
        { error: { message: `Maximum device limit (${keyRecord.maxDevices}) reached.`, type: "access_error" } },
        403
      );
    }
  }

  // ─── 7. Fetch Config & Parse Request Body ──────────────────────────────
  const config = await db.select().from(adminConfig).get();
  if (!config || !config.upstreamApiKey) {
    return c.json(
      { error: { message: "Upstream API not configured. Please configure via admin dashboard.", type: "server_error" } },
      503
    );
  }

  let requestBody: any = null;
  let model = "unknown";
  let contextTokensBefore = 0;
  let contextFingerprint = "";
  let requestPreview = "";
  let transcriptSnapshot = "";
  let requestToolNames: string[] = [];
  let estimatedContextLength = 0;
  const contentType = c.req.header("Content-Type") || "";
  let requestBodyBytes: Uint8Array | undefined;
  const canHaveBody = c.req.method !== "GET" && c.req.method !== "HEAD";

  if (canHaveBody) {
    try {
      const rawBuffer = await c.req.raw.arrayBuffer();
      if (rawBuffer.byteLength > 0) {
        requestBodyBytes = new Uint8Array(rawBuffer);
        const isProbablyJson = contentType.toLowerCase().includes("application/json");
        const isTextLike = contentType.toLowerCase().startsWith("text/");

        if (isProbablyJson || isTextLike) {
          const bodyText = new TextDecoder().decode(requestBodyBytes);
          if (bodyText) {
            try {
              requestBody = JSON.parse(bodyText);
            } catch {
              const normalizedBody = bodyText.replace(/\s+/g, " ").trim();
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

  if (requestBody) {
    const contextInfo = extractContextInfo(requestBody);
    model = requestBody?.model || contextInfo.model || "unknown";
    contextTokensBefore = contextInfo.contextTokensBefore;
    estimatedContextLength = contextInfo.contextTokensBefore;
    contextFingerprint = contextInfo.contextFingerprint;
    requestPreview = contextInfo.requestPreview;
    transcriptSnapshot = contextInfo.transcriptSnapshot;
    requestToolNames = contextInfo.requestToolNames;
  }

  // ─── 8. Analyze Request Messages ───────────────────────────────────────
  const messageAnalysis = analyzeRequestMessages(requestBody);

  // ─── 8b. Title gen / internal IDE requests: forward without session tracking ─
  // These are auto-generated by the IDE (e.g. generating chat title) and must
  // NOT create sessions, NOT count as prompts, NOT check limits.
  if (isTitleGenRequest(requestBody)) {
    const upstreamBase2 = config.upstreamEndpoint.replace(/\/$/, "");
    let upstreamPath2 = path;
    if (upstreamBase2.endsWith("/v1") && upstreamPath2.startsWith("/v1/")) upstreamPath2 = upstreamPath2.slice(3);
    const upstreamUrl2 = `${upstreamBase2}${upstreamPath2}`;
    const upstreamHeaders2: Record<string, string> = {};
    const blocked2 = new Set(["host","content-length","authorization","cookie","connection","keep-alive","transfer-encoding","upgrade"]);
    for (const [k, v] of c.req.raw.headers.entries()) { if (!blocked2.has(k.toLowerCase())) upstreamHeaders2[k] = v; }
    upstreamHeaders2["Authorization"] = `Bearer ${config.upstreamApiKey}`;
    upstreamHeaders2["x-forwarded-for"] = clientIp;
    if (contentType) upstreamHeaders2["Content-Type"] = contentType;
    try {
      const resp = await fetchUpstreamWithRetry(upstreamUrl2, { method: c.req.method, headers: upstreamHeaders2, body: requestBodyBytes as any }, requestBody?.stream === true, c.req.raw.signal);
      return new Response(resp.body, { status: resp.status, headers: resp.headers });
    } catch {
      return c.json({ error: { message: "Upstream request failed", type: "server_error" } }, 502);
    }
  }

  // ─── 9. Get Upstream Config & Session Info ──────────────────────────────
  // Wrapped in a per-device lock so concurrent requests from the same device
  // are serialized.  This prevents race conditions where two requests both
  // see "no session" and create duplicate sessions, or both read stale hash.
  const provider = detectProvider(config.upstreamEndpoint, model);
  const deviceLockKey = `${keyRecord.id}:${fingerprint}`;
  const { sessionInfo, isNewPrompt } = await withDeviceLock(deviceLockKey, async () => {
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
    });

    const isNewPrompt = sessionInfo.isNewUserPrompt;

    // Update in-memory hash cache ONLY for counted prompts.
    // If we cache hash for non-counted requests (like IDE compact setup),
    if (messageAnalysis.messageHash && isNewPrompt) {
      sessionHashCache.set(sessionInfo.sessionId, messageAnalysis.messageHash);
    }
    // Sync DB tracking fields (only write hash when counted)
    {
      const syncUpdates: Record<string, any> = {
        lastSeenAt: formatSqliteDate(),
        model,
      };
      if (messageAnalysis.messageHash && isNewPrompt) {
        syncUpdates.lastUserMessageHash = messageAnalysis.messageHash;
      }
      if (messageAnalysis.messageRole) {
        syncUpdates.lastMessageRole = messageAnalysis.messageRole;
      }
      if (contextTokensBefore > 0) {
        syncUpdates.lastContextTokens = contextTokensBefore;
      }
      if (contextFingerprint) {
        syncUpdates.contextFingerprint = contextFingerprint;
      }
      await db.update(chatSessions)
        .set(syncUpdates)
        .where(eq(chatSessions.sessionId, sessionInfo.sessionId))
        .run();
    }

    return { sessionInfo, isNewPrompt };
  });

  // ─── 10. Prompt & Model Limit Checks ───────────────────────────────────────
  //
  // Per-model limit: checked for EVERY request (not just new prompts).
  // This ensures that retries after hitting the limit are also blocked.
  // The count comes from request_logs WHERE is_counted_request=1, so only
  // real user prompts are counted — not IDE retries or tool follow-ups.
  {
    const mlCheck = await checkModelPromptLimit(
      keyRecord.id,
      model,
      keyRecord.perModelPromptLimit || 0,
      keyRecord.perModelPromptLimitWindow || null,
      config.globalPerModelPromptLimit || 0,
      config.globalPerModelPromptLimitWindow || "30m",
    );
    if (!mlCheck.allowed) {
      const windowStr = keyRecord.perModelPromptLimitWindow || config.globalPerModelPromptLimitWindow || "30m";
      const windowMs = parseRateLimitWindow(windowStr);
      const resetMs = await getWindowResetMs(keyRecord.id, windowMs, model);
      const resetMins = Math.ceil(resetMs / 60000);
      // Check how many prompts remain globally (across all models)
      const globalLimit = (keyRecord.promptLimit && keyRecord.promptLimit > 0 ? keyRecord.promptLimit : config.globalPromptLimit) || 0;
      const globalWindow = keyRecord.promptLimitWindow || config.globalPromptLimitWindow || "30m";
      const globalCheck = globalLimit > 0 ? await checkPromptLimit(keyRecord.id, globalLimit, globalWindow) : null;
      const globalRemaining = globalCheck ? globalCheck.remaining : -1;
      const isKeyOverride = (keyRecord.perModelPromptLimit || 0) > 0;
      const limitSource = isKeyOverride ? "your key's override" : "global default";
      const globalInfo = globalRemaining >= 0
        ? ` You have ${globalRemaining} prompt(s) remaining for other models.`
        : "";
      return c.json({
        error: {
          message: `Limit reached for model "${model}" (${limitSource}): ${mlCheck.used}/${mlCheck.effectiveLimit} prompts used. Resets in ~${resetMins} minute(s).${globalInfo}`,
          type: "rate_limit_error",
          code: "model_prompt_limit_exceeded",
        }
      }, 429, {
        "x-model-prompt-limit": String(mlCheck.effectiveLimit),
        "x-model-prompt-remaining": "0",
        "x-model-prompt-used": String(mlCheck.used),
        "x-model-prompt-reset-mins": String(resetMins),
      });
    }
  }

  // Global / Per-Key Prompt Limit (all models combined) — checked for EVERY request
  // so retries cannot bypass the limit when isNewPrompt=false.
  {
    const effectivePromptLimit = keyRecord.promptLimit && keyRecord.promptLimit > 0 ? keyRecord.promptLimit : config.globalPromptLimit;
    const effectivePromptLimitWindow = keyRecord.promptLimitWindow || config.globalPromptLimitWindow || "30m";

    if (effectivePromptLimit && effectivePromptLimit > 0) {
      const plCheck = await checkPromptLimit(keyRecord.id, effectivePromptLimit, effectivePromptLimitWindow);
      if (!plCheck.allowed) {
        const windowMs = parseRateLimitWindow(effectivePromptLimitWindow);
        const resetMs = await getWindowResetMs(keyRecord.id, windowMs);
        const resetMins = Math.ceil(resetMs / 60000);
        const isKeyOverride = (keyRecord.promptLimit || 0) > 0;
        return c.json({
          error: {
            message: `All model limit reached${isKeyOverride ? " (key override)" : ""}: ${plCheck.used}/${effectivePromptLimit} prompts used in this ${effectivePromptLimitWindow} window. Resets in ~${resetMins} minute(s).`,
            type: "rate_limit_error",
            code: "prompt_limit_exceeded",
          }
        }, 429, {
          "x-prompt-limit": String(effectivePromptLimit),
          "x-prompt-remaining": "0",
          "x-prompt-used": String(plCheck.used),
          "x-prompt-reset-mins": String(resetMins),
        });
      }
    }
  }

  if (isNewPrompt) {
    if (keyRecord.monthlyTokenLimit && keyRecord.monthlyTokenLimit > 0) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthlyUsage = await db
        .select({ total: sql<number>`COALESCE(SUM(total_tokens), 0)` })
        .from(requestLogs)
        .where(and(
          eq(requestLogs.apiKeyId, keyRecord.id),
          sql`created_at >= ${monthStart.toISOString()}`,
          sql`is_counted_request IS NOT 0`,
        ))
        .get();
      if (monthlyUsage && monthlyUsage.total >= keyRecord.monthlyTokenLimit) {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
        nextMonth.setHours(0, 0, 0, 0);
        const resetDate = nextMonth.toISOString().split("T")[0];
        const usedTokens = monthlyUsage.total.toLocaleString();
        const maxTokens = keyRecord.monthlyTokenLimit.toLocaleString();
        return c.json({
          error: {
            message: `Monthly token limit reached: ${usedTokens}/${maxTokens} tokens used this month. Resets on ${resetDate} (1st of next month).`,
            type: "rate_limit_error",
            code: "monthly_token_limit_exceeded",
          }
        }, 429);
      }
    }
  }

  const upstreamBase = config.upstreamEndpoint.replace(/\/$/, "");
  let upstreamPath = path;
  // Avoid /v1 duplication if upstream endpoint already ends with /v1
  if (upstreamBase.endsWith("/v1") && upstreamPath.startsWith("/v1/")) {
    upstreamPath = upstreamPath.slice(3);
  } else if (upstreamBase.endsWith("/v1") && upstreamPath === "/v1") {
    upstreamPath = "";
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

  const persistLogAndSession = async (logEntry: Record<string, any>, hasActualToolCalls: boolean, shouldCountRequest: boolean = true) => {
    enqueueLogWrite(async (tx) => {
      // Set the isCountedRequest column
      logEntry.isCountedRequest = isNewPrompt && shouldCountRequest;
      await tx.insert(requestLogs).values(logEntry).run();
      logEmitter.emit({
        ...logEntry,
        toolsUsed: parseToolJson(logEntry.toolsUsed),
      });

      // Only update session stats if request was successful
      if (shouldCountRequest) {
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

  // ─── 10. Forward Request to Upstream ────────────────────────────────────
  const upstreamHeaders: Record<string, string> = {};
  const blockedHeaders = new Set([
    "host",
    "content-length",
    "authorization",
    "cookie",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
  ]);

  for (const [headerKey, headerValue] of c.req.raw.headers.entries()) {
    if (!blockedHeaders.has(headerKey.toLowerCase())) {
      upstreamHeaders[headerKey] = headerValue;
    }
  }

  upstreamHeaders["Authorization"] = `Bearer ${config.upstreamApiKey}`;
  upstreamHeaders["x-forwarded-for"] = clientIp;
  if (contentType) upstreamHeaders["Content-Type"] = contentType;

  try {
    const upstreamResponse = await fetchUpstreamWithRetry(upstreamUrl, {
      method: c.req.method,
      headers: upstreamHeaders,
      body: requestBodyBytes as any,
    }, isStreaming, c.req.raw.signal);

    const latencyMs = Date.now() - startTime;
    const statusCode = upstreamResponse.status;

    // ─── 11. Register/Update Device ─────────────────────────────────────
    if (existingDevice) {
      await db.update(devices)
        .set({
          lastSeen: formatSqliteDate(),
          requestCount: existingDevice.requestCount + 1,
          ipAddress: clientIp,
          userAgentRaw: userAgent,
          osDetected,
          deviceName: deviceName || null,
          ideDetected: ide,
        })
        .where(eq(devices.id, existingDevice.id))
        .run();
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
      }).run();
    }

    // ─── 12. Handle Streaming Response ──────────────────────────────────
    if (isStreaming && upstreamResponse.body) {
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let streamedResponsePreview = "";
      let hasActualToolCalls = false;
      const decoder = new TextDecoder();

      const { readable, writable } = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          try {
            const text = decoder.decode(chunk, { stream: true });
            const lines = text.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ") && line !== "data: [DONE]") {
                const payloadText = line.slice(6).trim();
                if (!payloadText || payloadText === "[DONE]") continue;
                try {
                  const data = JSON.parse(payloadText);
                  appendToolsFromPayload(data);
                  
                  // Detect actual tool calls in response
                  if (detectToolCallsInResponse(data)) {
                    hasActualToolCalls = true;
                  }
                  
                  const deltaContent = data?.choices?.[0]?.delta?.content;
                  if (typeof deltaContent === "string") {
                    // Do not slice, keep full stream data for responsePreview
                    streamedResponsePreview = `${streamedResponsePreview}${deltaContent}`;
                  }
                  if (data.usage) {
                    promptTokens = data.usage.prompt_tokens || 0;
                    completionTokens = data.usage.completion_tokens || 0;
                    totalTokens = data.usage.total_tokens || 0;
                  }
                } catch {
                  // Ignore malformed stream chunks.
                }
              }
            }
          } catch {
            // Ignore decoder errors.
          }
        },
        flush() {
          const finalPromptTokens = promptTokens || contextTokensBefore;
          const finalTotalTokens = totalTokens || finalPromptTokens + completionTokens;
          const toolsUsed = Array.from(toolNameSet);

          const logEntry = {
            ...baseLogEntry,
            promptTokens: finalPromptTokens,
            completionTokens,
            totalTokens: finalTotalTokens,
            toolCount: toolsUsed.length,
            hasToolCalls: toolsUsed.length > 0,
            toolsUsed: toToolJson(toolsUsed),
            responsePreview: streamedResponsePreview || null,
            latencyMs: Date.now() - startTime,
            statusCode,
            estimatedCost: calculateEstimatedCost(model, finalPromptTokens, completionTokens),
            messageRole: messageAnalysis.messageRole,
            userMessageHash: messageAnalysis.messageHash,
            actualToolCallsInResponse: hasActualToolCalls,
          };

          // Only count request if status is 2xx (success)
          const shouldCountRequest = statusCode >= 200 && statusCode < 300;
          persistLogAndSession(logEntry, hasActualToolCalls, shouldCountRequest);
        },
      });

      upstreamResponse.body.pipeTo(writable).catch(() => {});

      const responseHeaders: Record<string, string> = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      };

      const copyHeaders = ["x-request-id", "openai-organization", "openai-processing-ms"];
      for (const h of copyHeaders) {
        const val = upstreamResponse.headers.get(h);
        if (val) responseHeaders[h] = val;
      }
      
      const rateLimitLimit = (c as any).get("x-ratelimit-limit-requests") as string;
      const rateLimitRemaining = (c as any).get("x-ratelimit-remaining-requests") as string;
      if (rateLimitLimit) responseHeaders["x-ratelimit-limit-requests"] = rateLimitLimit;
      if (rateLimitRemaining) responseHeaders["x-ratelimit-remaining-requests"] = rateLimitRemaining;

      return new Response(readable, { status: statusCode, headers: responseHeaders });
    }

    // ─── 13. Handle Non-Streaming Response ──────────────────────────────
    const responseBody = await upstreamResponse.text();
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let errorMessage: string | undefined;
    let responsePreview: string | null = null;
    let hasActualToolCalls = false;

    try {
      const parsed = JSON.parse(responseBody);
      appendToolsFromPayload(parsed);
      
      // Detect actual tool calls in response
      hasActualToolCalls = detectToolCallsInResponse(parsed);
      
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || 0;
        completionTokens = parsed.usage.completion_tokens || 0;
        totalTokens = parsed.usage.total_tokens || 0;
      }
      if (parsed.error) {
        errorMessage = parsed.error.message || JSON.stringify(parsed.error);
      }
      const firstChoice = parsed?.choices?.[0];
      const assistantText = typeof firstChoice?.message?.content === "string"
        ? firstChoice.message.content
        : typeof firstChoice?.text === "string"
          ? firstChoice.text
          : "";
      if (assistantText) {
        // Keep the full response in responsePreview so that tool output is not truncated.
        responsePreview = assistantText || null;
      }
    } catch {
      // Body might not be JSON.
    }

    if (!totalTokens && contextTokensBefore) {
      promptTokens = contextTokensBefore;
      totalTokens = contextTokensBefore + completionTokens;
    }

    const toolsUsed = Array.from(toolNameSet);

    const logEntry = {
      ...baseLogEntry,
      promptTokens,
      completionTokens,
      totalTokens,
      toolCount: toolsUsed.length,
      hasToolCalls: toolsUsed.length > 0,
      toolsUsed: toToolJson(toolsUsed),
      responsePreview,
      latencyMs,
      statusCode,
      errorMessage,
      estimatedCost: calculateEstimatedCost(model, promptTokens, completionTokens),
      messageRole: messageAnalysis.messageRole,
      userMessageHash: messageAnalysis.messageHash,
      actualToolCallsInResponse: hasActualToolCalls,
    };

    // Only count request if status is 2xx (success)
    const shouldCountRequest = statusCode >= 200 && statusCode < 300;
    persistLogAndSession(logEntry, hasActualToolCalls, shouldCountRequest);

    const responseHeaders: Record<string, string> = {
      "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json",
    };

    const copyHeaders = ["x-request-id", "openai-organization", "openai-processing-ms",
      "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens"];
    for (const h of copyHeaders) {
      const val = upstreamResponse.headers.get(h);
      if (val) responseHeaders[h] = val;
    }
    
    // We override upstream request limits with our proxy limits
    const rateLimitLimit = (c as any).get("x-ratelimit-limit-requests") as string;
    const rateLimitRemaining = (c as any).get("x-ratelimit-remaining-requests") as string;
    if (rateLimitLimit) responseHeaders["x-ratelimit-limit-requests"] = rateLimitLimit;
    if (rateLimitRemaining) responseHeaders["x-ratelimit-remaining-requests"] = rateLimitRemaining;

    return new Response(responseBody, { status: statusCode, headers: responseHeaders });
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error?.message || "Upstream request failed";
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

    return c.json({ error: { message: `Upstream error: ${errorMessage}`, type: "upstream_error" } }, 502);
  }
});

export default proxy;
