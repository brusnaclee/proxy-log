/**
 * Per-Discord-account usage overrides. Stored as JSON on admin_config.account_usage_overrides.
 * Used for Kyra-style accounts where is_no_log breaks turn/session grouping: meter as turns,
 * count every Nth as a prompt, optionally keep IDE on no-log keys.
 */
import { eq } from 'drizzle-orm';
import { adminConfig } from '../db/schema.js';
import { db } from '../db/index.js';

export type AccountUsageOverride = {
	/** Every Nth counted turn becomes 1 prompt (Kyra 100:1). 0/undefined = disabled. */
	turnsPerPrompt?: number;
	/** If true, no-log keys retain `ideDetected` on request_logs. */
	noLogKeepIde?: boolean;
};

let cache: { ts: number; map: Record<string, AccountUsageOverride> } | null = null;
const TTL_MS = 30_000;

export async function getAccountUsageOverrides(): Promise<Record<string, AccountUsageOverride>> {
	if (cache && Date.now() - cache.ts < TTL_MS) return cache.map;
	let raw = '{}';
	try {
		const rows = await db
			.select({ v: adminConfig.accountUsageOverrides })
			.from(adminConfig)
			.where(eq(adminConfig.id, 1))
			.limit(1);
		raw = rows[0]?.v || '{}';
	} catch {
		raw = '{}';
	}
	let parsed: Record<string, AccountUsageOverride> = {};
	try {
		// Tolerate accidental string-concat of multiple JSON objects from bad seed SQL.
		const trimmed = String(raw || '{}').trim();
		const firstObjEnd = trimmed.indexOf('}{');
		const candidate = firstObjEnd > 0 ? trimmed.slice(0, firstObjEnd + 1) : trimmed;
		const obj = JSON.parse(candidate);
		if (obj && typeof obj === 'object') parsed = obj as Record<string, AccountUsageOverride>;
	} catch (err) {
		console.warn('[account-usage-overrides] invalid JSON, ignoring:', (err as Error)?.message || err);
		parsed = {};
	}
	cache = { ts: Date.now(), map: parsed };
	return parsed;
}

export async function getAccountUsageOverride(
	discordUserId: string | null | undefined,
): Promise<AccountUsageOverride | null> {
	if (!discordUserId) return null;
	const map = await getAccountUsageOverrides();
	return map[discordUserId] || null;
}

/** Apply turnsPerPrompt dilution: floor(rawTurns / N). N<=0 → unchanged. */
export function dilutePromptCount(
	rawTurns: number,
	turnsPerPrompt: number | null | undefined,
): number {
	const n = Math.floor(Number(turnsPerPrompt) || 0);
	const turns = Math.max(0, Math.floor(Number(rawTurns) || 0));
	if (n <= 0) return turns;
	return Math.floor(turns / n);
}

/** Look up dilution N for a Discord user from a preloaded overrides map. */
export function turnsPerPromptForUser(
	discordUserId: string | null | undefined,
	overrides: Record<string, AccountUsageOverride>,
): number {
	if (!discordUserId) return 0;
	return Math.floor(Number(overrides[discordUserId]?.turnsPerPrompt) || 0);
}

/** Synchronous version for write-path hot loop; returns null on cold cache. */
export function getAccountUsageOverrideCached(
	discordUserId: string | null | undefined,
): AccountUsageOverride | null {
	if (!discordUserId || !cache) return null;
	return cache.map[discordUserId] || null;
}

/** Refresh the cache from DB (called when admin saves new overrides). */
export async function refreshAccountUsageOverridesCache(): Promise<void> {
	cache = null;
	await getAccountUsageOverrides();
}