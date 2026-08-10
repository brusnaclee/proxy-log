/**
 * Optional env-backed proxy key (API_DEDICATE).
 * No api_keys row — thin request_logs only, pruned to a short recent window.
 */
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys, requestLogs } from "../db/schema.js";
import { sha256 } from "./crypto.js";
import { buildLiveUsageForKey } from "./live-usage.js";

const EDGE_FLAG = Symbol.for("proxy.edgeKey");
const EDGE_CAMOUFLAGE = Symbol.for("proxy.edgeCamouflage");

/** Stable mark so only these rows are pruned (stored in user_message_hash, not shown as device fp). */
export const EDGE_LOG_MARK = sha256("proxy-edge-log-v1");

export const EDGE_LOG_KEEP = 100;

export type EdgeCamouflageProfile = {
	apiKeyName: string;
	ipAddress: string | null;
	deviceFingerprint: string | null;
	ideDetected: string | null;
	osDetected: string | null;
	clientName: string | null;
	userAgentRaw: string | null;
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	totalTokens: number;
	upstreamCredits: number;
	upstreamCreditsOut: number;
	contextFingerprint: string | null;
	contextTokensBefore: number;
	latencyMs: number;
};

export type EdgeKeyRecord = {
	id: number;
	name: string;
	key: string;
	keyPrefix: string;
	keyHash: string;
	discordUserId: null;
	discordUsername: null;
	isActive: true;
	isTrial: false;
	maxDevices: 0;
	devicePolicy: "none";
	ipPolicy: "none";
	idePolicy: "none";
	monthlyTokenLimit: 0;
	rateLimit: 0;
	rateLimitWindow: null;
	rateWindowStart: null;
	promptLimit: 0;
	promptLimitWindow: null;
	promptWindowStart: null;
	perModelPromptLimit: 0;
	perModelPromptLimitWindow: null;
	dailyTokenLimit: 0;
	dailyInputTokenLimit: 0;
	dailyOutputTokenLimit: 0;
	roleLimitMode: null;
	accountBadges: "[]";
	accountTier: "";
	provisionedBy: "env";
	[EDGE_FLAG]: true;
	[EDGE_CAMOUFLAGE]?: EdgeCamouflageProfile;
};

export function getEdgeApiKeyFromEnv(): string {
	return String(process.env.API_DEDICATE || "").trim();
}

/** True only when Bearer exactly matches API_DEDICATE (constant-time). */
export function matchesEdgeApiKey(token: string): boolean {
	const expected = getEdgeApiKeyFromEnv();
	if (!expected || !token) return false;
	try {
		const a = Buffer.from(token, "utf8");
		const b = Buffer.from(expected, "utf8");
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

export function isEdgeKeyRecord(rec: unknown): rec is EdgeKeyRecord {
	return !!(
		rec &&
		typeof rec === "object" &&
		(rec as any)[EDGE_FLAG] === true &&
		(rec as any).id === 0
	);
}

export function buildEdgeKeyRecord(
	displayName: string,
	profile?: EdgeCamouflageProfile | null,
): EdgeKeyRecord {
	const name = String(displayName || profile?.apiKeyName || "user").trim() || "user";
	const rec: EdgeKeyRecord = {
		id: 0,
		name,
		key: "",
		keyPrefix: "sk-proxy-",
		keyHash: "",
		discordUserId: null,
		discordUsername: null,
		isActive: true,
		isTrial: false,
		maxDevices: 0,
		devicePolicy: "none",
		ipPolicy: "none",
		idePolicy: "none",
		monthlyTokenLimit: 0,
		rateLimit: 0,
		rateLimitWindow: null,
		rateWindowStart: null,
		promptLimit: 0,
		promptLimitWindow: null,
		promptWindowStart: null,
		perModelPromptLimit: 0,
		perModelPromptLimitWindow: null,
		dailyTokenLimit: 0,
		dailyInputTokenLimit: 0,
		dailyOutputTokenLimit: 0,
		roleLimitMode: null,
		accountBadges: "[]",
		accountTier: "",
		provisionedBy: "env",
		[EDGE_FLAG]: true,
	};
	if (profile) rec[EDGE_CAMOUFLAGE] = profile;
	return rec;
}

export function getEdgeCamouflage(rec: unknown): EdgeCamouflageProfile | null {
	if (!isEdgeKeyRecord(rec)) return null;
	return rec[EDGE_CAMOUFLAGE] || null;
}

type RecentHop = {
	apiKeyId: number | null;
	apiKeyName: string | null;
	ipAddress: string | null;
	deviceFingerprint: string | null;
	ideDetected: string | null;
	osDetected: string | null;
	clientName: string | null;
	userAgentRaw: string | null;
	promptTokens: number | null;
	cachedTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	upstreamCredits: number | null;
	upstreamCreditsOut: number | null;
	contextFingerprint: string | null;
	contextTokensBefore: number | null;
	latencyMs: number | null;
};

function hopToProfile(hop: RecentHop, name: string): EdgeCamouflageProfile {
	const prompt = Math.max(0, Number(hop.promptTokens) || 0);
	const cached = Math.max(0, Number(hop.cachedTokens) || 0);
	const completion = Math.max(0, Number(hop.completionTokens) || 0);
	const total =
		Math.max(0, Number(hop.totalTokens) || 0) || prompt + cached + completion;
	return {
		apiKeyName: name,
		ipAddress: hop.ipAddress || null,
		deviceFingerprint: hop.deviceFingerprint || null,
		ideDetected: hop.ideDetected || null,
		osDetected: hop.osDetected || null,
		clientName: hop.clientName || null,
		userAgentRaw: hop.userAgentRaw || null,
		promptTokens: prompt,
		cachedTokens: cached,
		completionTokens: completion,
		totalTokens: total,
		upstreamCredits: Math.max(0, Number(hop.upstreamCredits) || 0),
		upstreamCreditsOut: Math.max(0, Number(hop.upstreamCreditsOut) || 0),
		contextFingerprint: hop.contextFingerprint || null,
		contextTokensBefore: Math.max(0, Number(hop.contextTokensBefore) || 0),
		latencyMs: Math.max(0, Number(hop.latencyMs) || 0),
	};
}

/**
 * True when the donor account still looks able to make normal (non-dedicated-only) calls.
 * Skip users who are addon-blocked or fully out of shared daily/prompt quota.
 */
export async function donorLooksAvailable(apiKeyId: number): Promise<boolean> {
	try {
		const key = await db
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.id, apiKeyId))
			.limit(1)
			.then((r) => r[0]);
		if (!key || !key.isActive) return false;

		const live = await buildLiveUsageForKey(key as any);
		if (live.blockedWithoutAddon) return false;

		const dailyLimit = Number(live.limits?.dailyTokenLimit) || 0;
		const promptLimit = Number(live.limits?.promptLimit) || 0;
		const inputLimit = Number(live.limits?.dailyInputTokenLimit) || 0;
		const dailyRem = live.remaining?.daily;
		const promptRem = live.remaining?.prompt;
		const inputRem = live.remaining?.input;

		if (dailyLimit > 0 && dailyRem === 0) return false;
		if (promptLimit > 0 && promptRem === 0) return false;
		if (inputLimit > 0 && inputRem === 0) return false;

		return true;
	} catch {
		return false;
	}
}

function modeName(names: string[]): string | null {
	if (!names.length) return null;
	const counts = new Map<string, number>();
	for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
	let best = names[0];
	let bestN = 0;
	for (const [n, c] of counts) {
		if (c > bestN) {
			best = n;
			bestN = c;
		}
	}
	return best;
}

/**
 * Pick a camouflage identity from recent traffic:
 * 1) Prefer mode of last 5 names if that donor is not limited
 * 2) Else scan up to 10 distinct recent users who are not limited
 */
export async function pickCamouflageProfile(): Promise<EdgeCamouflageProfile> {
	const fallback: EdgeCamouflageProfile = {
		apiKeyName: "user",
		ipAddress: null,
		deviceFingerprint: null,
		ideDetected: null,
		osDetected: null,
		clientName: null,
		userAgentRaw: null,
		promptTokens: 0,
		cachedTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		upstreamCredits: 0,
		upstreamCreditsOut: 0,
		contextFingerprint: null,
		contextTokensBefore: 0,
		latencyMs: 0,
	};

	try {
		const rows = (await db
			.select({
				apiKeyId: requestLogs.apiKeyId,
				apiKeyName: requestLogs.apiKeyName,
				ipAddress: requestLogs.ipAddress,
				deviceFingerprint: requestLogs.deviceFingerprint,
				ideDetected: requestLogs.ideDetected,
				osDetected: requestLogs.osDetected,
				clientName: requestLogs.clientName,
				userAgentRaw: requestLogs.userAgentRaw,
				promptTokens: requestLogs.promptTokens,
				cachedTokens: requestLogs.cachedTokens,
				completionTokens: requestLogs.completionTokens,
				totalTokens: requestLogs.totalTokens,
				upstreamCredits: requestLogs.upstreamCredits,
				upstreamCreditsOut: requestLogs.upstreamCreditsOut,
				contextFingerprint: requestLogs.contextFingerprint,
				contextTokensBefore: requestLogs.contextTokensBefore,
				latencyMs: requestLogs.latencyMs,
			})
			.from(requestLogs)
			.where(
				and(
					isNotNull(requestLogs.apiKeyId),
					isNotNull(requestLogs.apiKeyName),
					ne(requestLogs.apiKeyName, ""),
					sql`COALESCE(${requestLogs.userMessageHash}, '') <> ${EDGE_LOG_MARK}`,
					sql`COALESCE(${requestLogs.contextFingerprint}, '') <> ${EDGE_LOG_MARK}`,
					sql`${requestLogs.statusCode} BETWEEN 200 AND 299`,
				),
			)
			.orderBy(desc(requestLogs.id))
			.limit(80)) as RecentHop[];

		if (!rows.length) return fallback;

		const last5Names = rows
			.slice(0, 5)
			.map((r) => String(r.apiKeyName || "").trim())
			.filter(Boolean);
		const preferred = modeName(last5Names);

		const byName = new Map<string, RecentHop>();
		const distinctOrder: string[] = [];
		for (const r of rows) {
			const name = String(r.apiKeyName || "").trim();
			if (!name || !r.apiKeyId) continue;
			if (!byName.has(name)) {
				byName.set(name, r);
				distinctOrder.push(name);
			}
			if (distinctOrder.length >= 10 && byName.has(preferred || "")) break;
		}

		const tryNames: string[] = [];
		if (preferred) tryNames.push(preferred);
		for (const n of distinctOrder) {
			if (!tryNames.includes(n)) tryNames.push(n);
			if (tryNames.length >= 10) break;
		}

		for (const name of tryNames) {
			const hop = byName.get(name);
			if (!hop?.apiKeyId) continue;
			const ok = await donorLooksAvailable(Number(hop.apiKeyId));
			if (!ok) continue;
			return hopToProfile(hop, name);
		}

		// Last resort: use preferred/first hop metadata even if limit check failed
		const hop = (preferred && byName.get(preferred)) || rows[0];
		return hopToProfile(hop, String(hop.apiKeyName || "user").trim() || "user");
	} catch {
		return fallback;
	}
}

/** @deprecated use pickCamouflageProfile */
export async function pickCamouflageApiKeyName(): Promise<string> {
	const p = await pickCamouflageProfile();
	return p.apiKeyName;
}

/** Apply thin-log + camouflage fields. Safe no-op when not an edge record. */
export function applyEdgeLogFields(
	entry: Record<string, any>,
	keyRecord: unknown,
): Record<string, any> {
	if (!isEdgeKeyRecord(keyRecord)) return entry;
	const profile = getEdgeCamouflage(keyRecord);

	entry.apiKeyId = null;
	entry.apiKeyName = profile?.apiKeyName || keyRecord.name || "user";
	entry.requestPreview = null;
	entry.responsePreview = null;
	entry.transcriptSnapshot = null;
	entry.toolsUsed = null;
	entry.errorMessage = null;
	entry.isCountedRequest = false;
	entry.isBillableToken = false;
	entry.userMessageHash = EDGE_LOG_MARK;

	if (profile) {
		entry.ipAddress = profile.ipAddress;
		entry.deviceFingerprint = profile.deviceFingerprint;
		entry.ideDetected = profile.ideDetected;
		entry.osDetected = profile.osDetected;
		entry.clientName = profile.clientName;
		entry.userAgentRaw = profile.userAgentRaw;
		entry.promptTokens = profile.promptTokens;
		entry.cachedTokens = profile.cachedTokens;
		entry.completionTokens = profile.completionTokens;
		entry.totalTokens = profile.totalTokens;
		entry.upstreamCredits = profile.upstreamCredits;
		entry.upstreamCreditsOut = profile.upstreamCreditsOut;
		entry.contextFingerprint = profile.contextFingerprint;
		entry.contextTokensBefore = profile.contextTokensBefore;
		if (profile.latencyMs > 0) entry.latencyMs = profile.latencyMs;
	}

	return entry;
}

/** Keep only the newest EDGE_LOG_KEEP thin logs; delete the rest. */
export async function pruneEdgeRequestLogs(keep = EDGE_LOG_KEEP): Promise<void> {
	const k = Math.max(1, Math.min(500, Number(keep) || EDGE_LOG_KEEP));
	try {
		await db.execute(sql`
			DELETE FROM request_logs
			WHERE user_message_hash = ${EDGE_LOG_MARK}
			  AND id NOT IN (
				SELECT id FROM (
					SELECT id FROM request_logs
					WHERE user_message_hash = ${EDGE_LOG_MARK}
					ORDER BY id DESC
					LIMIT ${sql.raw(String(k))}
				) keep_ids
			)
		`);
		// Also prune legacy rows marked via context_fingerprint
		await db.execute(sql`
			DELETE FROM request_logs
			WHERE context_fingerprint = ${EDGE_LOG_MARK}
			  AND (user_message_hash IS NULL OR user_message_hash <> ${EDGE_LOG_MARK})
			  AND id NOT IN (
				SELECT id FROM (
					SELECT id FROM request_logs
					WHERE context_fingerprint = ${EDGE_LOG_MARK}
					ORDER BY id DESC
					LIMIT ${sql.raw(String(k))}
				) keep_ids
			)
		`);
	} catch (err) {
		console.warn("[edge-key] prune failed:", (err as Error)?.message || err);
	}
}
