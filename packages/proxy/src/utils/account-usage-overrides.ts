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
		const obj = JSON.parse(raw);
		if (obj && typeof obj === 'object') parsed = obj as Record<string, AccountUsageOverride>;
	} catch {
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