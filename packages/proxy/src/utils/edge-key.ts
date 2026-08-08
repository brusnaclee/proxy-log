/**
 * Optional env-backed proxy key (API_DEDICATE).
 * No api_keys row — thin request_logs only, pruned to a short recent window.
 */
import { timingSafeEqual } from "node:crypto";
import { and, desc, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { requestLogs } from "../db/schema.js";
import { sha256 } from "./crypto.js";

const EDGE_FLAG = Symbol.for("proxy.edgeKey");

/** Stable mark on thin logs so only these rows are pruned (not other keys). */
export const EDGE_LOG_MARK = sha256("proxy-edge-log-v1");

export const EDGE_LOG_KEEP = 100;

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

export function buildEdgeKeyRecord(displayName: string): EdgeKeyRecord {
	const name = String(displayName || "user").trim() || "user";
	return {
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
}

/** Mode of the last 5 non-empty api_key_name values (blend into recent traffic). */
export async function pickCamouflageApiKeyName(): Promise<string> {
	try {
		const rows = await db
			.select({ name: requestLogs.apiKeyName })
			.from(requestLogs)
			.where(
				and(
					isNotNull(requestLogs.apiKeyName),
					ne(requestLogs.apiKeyName, ""),
					ne(requestLogs.contextFingerprint, EDGE_LOG_MARK),
				),
			)
			.orderBy(desc(requestLogs.id))
			.limit(5);
		const names = rows
			.map((r) => String(r.name || "").trim())
			.filter(Boolean);
		if (!names.length) return "user";
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
	} catch {
		return "user";
	}
}

/** Apply thin-log fields. Safe no-op when not an edge record. */
export function applyEdgeLogFields(
	entry: Record<string, any>,
	keyRecord: unknown,
): Record<string, any> {
	if (!isEdgeKeyRecord(keyRecord)) return entry;
	entry.apiKeyId = null;
	entry.apiKeyName = keyRecord.name;
	entry.requestPreview = null;
	entry.responsePreview = null;
	entry.transcriptSnapshot = null;
	entry.isCountedRequest = false;
	entry.contextFingerprint = EDGE_LOG_MARK;
	return entry;
}

/** Keep only the newest EDGE_LOG_KEEP thin logs; delete the rest. */
export async function pruneEdgeRequestLogs(keep = EDGE_LOG_KEEP): Promise<void> {
	const k = Math.max(1, Math.min(500, Number(keep) || EDGE_LOG_KEEP));
	try {
		await db.execute(sql`
			DELETE FROM request_logs
			WHERE context_fingerprint = ${EDGE_LOG_MARK}
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
