/**
 * Live daily/monthly usage + remaining quota — same semantics as portal /me
 * (account-scoped when Discord-linked, key override vs global limits).
 */

import { and, eq, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiKeys, adminConfig, requestLogs } from '../db/schema.js';
import {
	turnCountSql,
	turnPromptTokensSql,
	turnCompletionTokensSql,
	turnTotalTokensSql,
	wibMonthStartSql,
} from './counting.js';
import { resolveKeyDailyTokenLimit } from './trial-config.js';

export type LimitSource = 'override' | 'global' | 'none';

export interface LiveUsagePayload {
	scope: 'account' | 'key';
	accountKeyCount: number;
	usageToday: {
		requests: number;
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	usageMonth: {
		totalTokens: number;
	};
	limits: {
		dailyTokenLimit: number;
		dailyTokenLimitSource: LimitSource;
		dailyInputTokenLimit: number;
		dailyInputTokenLimitSource: LimitSource;
		dailyOutputTokenLimit: number;
		dailyOutputTokenLimitSource: LimitSource;
		monthlyTokenLimit: number;
		monthlyTokenLimitSource: LimitSource;
	};
	remaining: {
		input: number | null;
		output: number | null;
		daily: number | null;
		monthly: number | null;
	};
	dailyResetAt: string;
	monthlyResetAt: string;
}

function pickLimit(
	keyVal: number | null | undefined,
	globalVal: number | null | undefined,
): { value: number; source: LimitSource } {
	const k = Number(keyVal) || 0;
	const g = Number(globalVal) || 0;
	if (k > 0) return { value: k, source: 'override' };
	if (g > 0) return { value: g, source: 'global' };
	return { value: 0, source: 'none' };
}

function wibTodayStartDate(): Date {
	const now = new Date();
	const wibOffset = 7 * 60 * 60 * 1000;
	const wibNow = new Date(now.getTime() + wibOffset);
	wibNow.setUTCHours(0, 0, 0, 0);
	return new Date(wibNow.getTime() - wibOffset);
}

function resetTimestamps(): { dailyResetAt: string; monthlyResetAt: string } {
	const wibOffset = 7 * 60 * 60 * 1000;
	const wibNow = new Date(Date.now() + wibOffset);
	const tomorrowWib = new Date(wibNow);
	tomorrowWib.setUTCDate(tomorrowWib.getUTCDate() + 1);
	tomorrowWib.setUTCHours(0, 0, 0, 0);
	const dailyResetAt = new Date(tomorrowWib.getTime() - wibOffset).toISOString();
	const nextMonthWib = new Date(wibNow);
	nextMonthWib.setUTCMonth(nextMonthWib.getUTCMonth() + 1);
	nextMonthWib.setUTCDate(1);
	nextMonthWib.setUTCHours(0, 0, 0, 0);
	const monthlyResetAt = new Date(nextMonthWib.getTime() - wibOffset).toISOString();
	return { dailyResetAt, monthlyResetAt };
}

function rem(limit: number, used: number): number | null {
	if (!(limit > 0)) return null;
	return Math.max(0, limit - used);
}

type KeyRow = typeof apiKeys.$inferSelect;
type ConfigRow = typeof adminConfig.$inferSelect;

/**
 * Build live usage for an API key. When Discord-linked, aggregates usage across
 * all keys for that Discord user (same as client portal).
 */
export async function buildLiveUsageForKey(
	key: KeyRow,
	config?: ConfigRow | null,
): Promise<LiveUsagePayload> {
	const cfg = config ?? (await db.select().from(adminConfig).limit(1))[0] ?? null;
	const todayStart = wibTodayStartDate();
	const monthStart = new Date(wibMonthStartSql().replace(' ', 'T') + 'Z');
	const { dailyResetAt, monthlyResetAt } = resetTimestamps();
	const tmOpts = key.isTrial ? { isTrial: true as const } : undefined;

	let scope: 'account' | 'key' = 'key';
	let accountKeys: KeyRow[] = [key];
	if (key.discordUserId) {
		accountKeys = await db
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.discordUserId, key.discordUserId));
		if (accountKeys.length === 0) accountKeys = [key];
		scope = 'account';
	}
	const keyIds = accountKeys.map((k) => k.id);

	// Limits from primary active non-trial key when account-scoped (portal parity)
	const primaryKey =
		accountKeys.find((k) => !k.isTrial && k.isActive) ||
		accountKeys.find((k) => k.isActive) ||
		key;

	const whereToday = and(
		inArray(requestLogs.apiKeyId, keyIds),
		sql`created_at >= ${todayStart}`,
		sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
	)!;
	const whereMonth = and(
		inArray(requestLogs.apiKeyId, keyIds),
		sql`created_at >= ${monthStart}`,
		sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
	)!;

	const [usageToday, usageMonth] = await Promise.all([
		db
			.select({
				requests: turnCountSql(whereToday),
				promptTokens: turnPromptTokensSql(whereToday, tmOpts),
				completionTokens: turnCompletionTokensSql(whereToday, tmOpts),
			})
			.from(requestLogs)
			.where(whereToday)
			.then((r) => r[0]),
		db
			.select({
				tokens: turnTotalTokensSql(whereMonth, tmOpts),
			})
			.from(requestLogs)
			.where(whereMonth)
			.then((r) => r[0]),
	]);

	const promptTokens = usageToday?.promptTokens || 0;
	const completionTokens = usageToday?.completionTokens || 0;
	const totalTokens = promptTokens + completionTokens;
	const monthTokens = usageMonth?.tokens || 0;

	const dailyInput = pickLimit(primaryKey.dailyInputTokenLimit, cfg?.globalDailyInputTokenLimit);
	const dailyOutput = pickLimit(primaryKey.dailyOutputTokenLimit, cfg?.globalDailyOutputTokenLimit);
	const monthly = pickLimit(primaryKey.monthlyTokenLimit, cfg?.globalMonthlyTokenLimit);
	const dailyTokenLimit = resolveKeyDailyTokenLimit(primaryKey as any, cfg);
	const dailyTok =
		dailyTokenLimit > 0
			? {
					value: dailyTokenLimit,
					source: (Number(primaryKey.dailyTokenLimit) > 0
						? 'override'
						: 'global') as LimitSource,
				}
			: { value: 0, source: 'none' as LimitSource };

	return {
		scope,
		accountKeyCount: keyIds.length,
		usageToday: {
			requests: usageToday?.requests || 0,
			promptTokens,
			completionTokens,
			totalTokens,
		},
		usageMonth: {
			totalTokens: monthTokens,
		},
		limits: {
			dailyTokenLimit: dailyTok.value,
			dailyTokenLimitSource: dailyTok.source,
			dailyInputTokenLimit: dailyInput.value,
			dailyInputTokenLimitSource: dailyInput.source,
			dailyOutputTokenLimit: dailyOutput.value,
			dailyOutputTokenLimitSource: dailyOutput.source,
			monthlyTokenLimit: monthly.value,
			monthlyTokenLimitSource: monthly.source,
		},
		remaining: {
			input: rem(dailyInput.value, promptTokens),
			output: rem(dailyOutput.value, completionTokens),
			daily: rem(dailyTok.value, totalTokens),
			monthly: rem(monthly.value, monthTokens),
		},
		dailyResetAt,
		monthlyResetAt,
	};
}
