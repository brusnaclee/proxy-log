/**
 * Live daily/monthly/prompt usage + remaining — portal /me semantics for admin.
 * Usage is account-scoped when Discord-linked; limits come from the viewed key
 * (so per-key overrides show correctly on Key Detail / Keys list rows).
 */

import { and, eq, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiKeys, adminConfig, requestLogs, modelLimits } from '../db/schema.js';
import {
	turnCountSql,
	turnPromptTokensSql,
	turnCompletionTokensSql,
	turnBillablePromptTokensSql,
	turnCachedTokensSql,
	hopCountSql,
	hopFullInputTokensSql,
	weightedHopTotalTokensSql,
	wibMonthStartSql,
	sanitizeRows,
} from './counting.js';
import { resolveKeyApiCallLimit, resolveKeyDailyTokenLimit, resolveKeyPromptLimit } from './trial-config.js';
import {
	checkApiCallLimit,
	checkPromptLimit,
	checkModelPromptLimit,
	parseRateLimitWindow,
	getWindowResetMs,
	getApiCallWindowResetMs,
} from './rate-limit.js';
import {
	ADDON_TEASE_DEFAULT_PROMPT_LIMIT,
	getActiveAddonsForUser,
	isAddonTeaseModel,
	parseModelDailyLimits,
	resolveAddonQuotaStack,
	sumAddonDailyTokenBonus,
} from './addons.js';

export type LimitSource = 'override' | 'global' | 'none';

export interface ModelPromptUsage {
	model: string;
	used: number;
	limit: number;
	window: string;
	remaining: number | null;
	resetAt: string | null;
	source: LimitSource;
}

export interface LiveUsagePayload {
	scope: 'account' | 'key';
	accountKeyCount: number;
	usageToday: {
		/** Distinct turns (user prompts + tool chains), not log-row hops. */
		requests: number;
		/** Every upstream API call today (matches Logs table row count). */
		hopCount: number;
		promptTokens: number;
		billablePromptTokens: number;
		cachedTokens: number;
		/** SUM(prompt+cache) every hop — amanai / provider In style. */
		fullInputTokens: number;
		completionTokens: number;
		totalTokens: number;
		/** Rolling prompt-window usage: distinct turns in prompt window. */
		promptCount: number;
		/** Rolling API-call window usage: every 2xx hop. */
		apiCallCount: number;
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
		promptLimit: number;
		promptLimitWindow: string;
		promptLimitSource: LimitSource;
		apiCallLimit: number;
		apiCallLimitWindow: string;
		apiCallLimitSource: LimitSource;
		perModelPromptLimit: number;
		perModelPromptLimitWindow: string;
		perModelPromptLimitSource: LimitSource;
	};
	remaining: {
		input: number | null;
		output: number | null;
		daily: number | null;
		monthly: number | null;
		prompt: number | null;
		apiCalls: number | null;
	};
	dailyResetAt: string;
	monthlyResetAt: string;
	promptResetAt: string | null;
	promptResetMins: number;
	apiCallResetAt: string | null;
	apiCallResetMins: number;
	modelUsageLimits: ModelPromptUsage[];
	/** When add-on active: base + pack breakdown for UI */
	dailyTokenBreakdown?: {
		base: number;
		addonBonus: number;
		effective: number;
		bypassIo?: boolean;
		inputBase?: number;
		outputBase?: number;
	};
	activeAddons?: Array<{
		name: string;
		expiresAt: string | null;
		dailyTokenLimit: number;
	}>;
	/** Pack per-model token subcaps (not prompt caps) */
	addonModelTokenCaps?: Array<{ pattern: string; dailyLimit: number }>;
	perModelPromptsBypassedByAddon?: boolean;
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
 * Build live usage for an API key.
 * - Usage: Discord account aggregate when linked (portal parity)
 * - Limits: from the viewed key so per-key overrides are visible
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

	// Limits from the VIEWED key (per-key override), not primaryKey
	const limitKey = key;

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

	const whereTodayHops = and(
		inArray(requestLogs.apiKeyId, keyIds),
		sql`created_at >= ${todayStart}`,
		sql`status_code BETWEEN 200 AND 299`,
	)!;
	const whereMonthHops = and(
		inArray(requestLogs.apiKeyId, keyIds),
		sql`created_at >= ${monthStart}`,
		sql`status_code BETWEEN 200 AND 299`,
	)!;

	const [usageToday, usageMonth, limitUsageToday] = await Promise.all([
		db
			.select({
				requests: turnCountSql(whereToday),
				hopCount: hopCountSql(whereTodayHops),
				promptTokens: turnPromptTokensSql(whereToday, tmOpts),
				billablePromptTokens: turnBillablePromptTokensSql(whereToday, tmOpts),
				cachedTokens: turnCachedTokensSql(whereToday, tmOpts),
				fullInputTokens: hopFullInputTokensSql(whereTodayHops, tmOpts),
				completionTokens: turnCompletionTokensSql(whereToday, tmOpts),
			})
			.from(requestLogs)
			.where(whereToday)
			.then((r) => r[0]),
		db
			.select({
				tokens: weightedHopTotalTokensSql(whereMonthHops, tmOpts),
			})
			.from(requestLogs)
			.where(whereMonthHops)
			.then((r) => r[0]),
		db
			.select({
				tokens: weightedHopTotalTokensSql(whereTodayHops, tmOpts),
			})
			.from(requestLogs)
			.where(whereTodayHops)
			.then((r) => r[0]),
	]);

	const promptTokens = usageToday?.promptTokens || 0;
	const billablePromptTokens = usageToday?.billablePromptTokens || 0;
	const cachedTokens = usageToday?.cachedTokens || 0;
	const fullInputTokens = usageToday?.fullInputTokens || 0;
	const hopCount = usageToday?.hopCount || 0;
	const completionTokens = usageToday?.completionTokens || 0;
	// Credit / remaining bars use weighted hop-sum (same as proxy daily gate).
	const totalTokens = limitUsageToday?.tokens || 0;
	const monthTokens = usageMonth?.tokens || 0;

	const activeAddons = !limitKey.isTrial
		? await getActiveAddonsForUser({
				discordUserId: limitKey.discordUserId,
				apiKeyId: limitKey.id,
			})
		: [];
	const addonDailyBonus = sumAddonDailyTokenBonus(activeAddons);

	const rawDailyInput = pickLimit(limitKey.dailyInputTokenLimit, cfg?.globalDailyInputTokenLimit);
	const rawDailyOutput = pickLimit(limitKey.dailyOutputTokenLimit, cfg?.globalDailyOutputTokenLimit);
	const monthly = pickLimit(limitKey.monthlyTokenLimit, cfg?.globalMonthlyTokenLimit);
	const baseDailyTokenLimit = resolveKeyDailyTokenLimit(limitKey as any, cfg);
	const stack = resolveAddonQuotaStack({
		hasActiveAddon: activeAddons.length > 0,
		keyOrGlobalDaily: baseDailyTokenLimit,
		dailyInput: rawDailyInput.value,
		dailyOutput: rawDailyOutput.value,
		addonDailyBonus,
	});
	// Display: keep soft I/O bases visible when add-on (enforcement is daily-only).
	const dailyInput = stack.bypassIo
		? {
				value: stack.inputBase > 0 ? stack.inputBase : rawDailyInput.value,
				source: rawDailyInput.source === 'none' && stack.inputBase > 0 ? 'global' : rawDailyInput.source,
			}
		: rawDailyInput;
	const dailyOutput = stack.bypassIo
		? {
				value: stack.outputBase > 0 ? stack.outputBase : rawDailyOutput.value,
				source:
					rawDailyOutput.source === 'none' && stack.outputBase > 0
						? 'global'
						: rawDailyOutput.source,
			}
		: rawDailyOutput;
	const dailyTokenLimit = stack.effectiveDaily;
	const dailyTok =
		dailyTokenLimit > 0
			? {
					value: dailyTokenLimit,
					source: (stack.addonBonus > 0
						? 'override'
						: Number(limitKey.dailyTokenLimit) > 0
							? 'override'
							: 'global') as LimitSource,
				}
			: { value: 0, source: 'none' as LimitSource };

	const dailyTokenBreakdown = {
		base: stack.baseDaily,
		addonBonus: stack.addonBonus,
		effective: stack.effectiveDaily,
		bypassIo: stack.bypassIo,
		inputBase: stack.inputBase,
		outputBase: stack.outputBase,
	};
	const activeAddonsSummary = activeAddons.map((a) => ({
		name: a.name,
		expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null,
		dailyTokenLimit: a.dailyTokenLimit || 0,
	}));
	const addonModelTokenCaps: Array<{ pattern: string; dailyLimit: number }> = [];
	const capSeen = new Set<string>();
	for (const a of activeAddons) {
		const caps = parseModelDailyLimits(a.modelDailyLimits);
		for (const [pattern, dailyLimit] of Object.entries(caps)) {
			const key = `${pattern}:${dailyLimit}`;
			if (capSeen.has(key)) continue;
			capSeen.add(key);
			addonModelTokenCaps.push({ pattern, dailyLimit });
		}
	}
	const perModelPromptsBypassedByAddon = stack.bypassPerModelPrompts;

	const { limit: promptLimit, window: promptLimitWindow } = resolveKeyPromptLimit(
		limitKey as any,
		cfg,
	);
	const promptLimitSource: LimitSource =
		promptLimit > 0
			? Number(limitKey.promptLimit) > 0
				? 'override'
				: 'global'
			: 'none';

	const { limit: apiCallLimit, window: apiCallLimitWindow } = resolveKeyApiCallLimit(
		limitKey as any,
		cfg,
	);
	const apiCallLimitSource: LimitSource =
		apiCallLimit > 0
			? Number(limitKey.rateLimit) > 0
				? 'override'
				: 'global'
			: 'none';

	const perModelPick = pickLimit(
		limitKey.perModelPromptLimit,
		cfg?.globalPerModelPromptLimit,
	);
	const perModelWindow =
		limitKey.perModelPromptLimitWindow ||
		cfg?.globalPerModelPromptLimitWindow ||
		'5h';

	// Prompt window usage — account-scoped (shared across Discord keys)
	let promptUsed = 0;
	let promptResetAt: string | null = null;
	let promptResetMins = 0;
	const windowKeyId = limitKey.id;
	const promptScopeIds = [
		windowKeyId,
		...keyIds.filter((id) => id !== windowKeyId),
	];
	if (promptLimit > 0 && promptScopeIds.length > 0) {
		const plCheck = await checkPromptLimit(promptScopeIds, promptLimit, promptLimitWindow);
		promptUsed = plCheck.used;
		const windowMs = parseRateLimitWindow(promptLimitWindow);
		const resetMs = await getWindowResetMs(promptScopeIds, windowMs);
		promptResetMins = Math.ceil(resetMs / 60000);
		promptResetAt = resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null;
	}

	let apiCallUsed = 0;
	let apiCallResetAt: string | null = null;
	let apiCallResetMins = 0;
	if (apiCallLimit > 0 && promptScopeIds.length > 0) {
		const acCheck = await checkApiCallLimit(promptScopeIds, apiCallLimit, apiCallLimitWindow);
		apiCallUsed = acCheck.used;
		const windowMs = parseRateLimitWindow(apiCallLimitWindow);
		const resetMs = await getApiCallWindowResetMs(promptScopeIds, windowMs);
		apiCallResetMins = Math.ceil(resetMs / 60000);
		apiCallResetAt = resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null;
	}

	const modelUsageLimits: ModelPromptUsage[] = [];
	// Any active add-on → bypass all per-model prompt override/tease rows in UI
	if (!limitKey.isTrial && promptScopeIds.length > 0 && activeAddons.length === 0) {
		const todayModels = sanitizeRows(
			(
				await db.execute(sql`
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        COUNT(DISTINCT turn_id)::int as requests
      FROM request_logs
      WHERE api_key_id IN (${sql.join(
				promptScopeIds.map((id) => sql`${id}`),
				sql`, `,
			)})
        AND created_at >= ${todayStart}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY 1
      ORDER BY requests DESC
      LIMIT 12
    `)
			).rows as any[],
			['requests'],
		);

		const perKeyDefault = limitKey.perModelPromptLimit || 0;
		const perKeyWindow = limitKey.perModelPromptLimitWindow || null;
		const globalPerModel = cfg?.globalPerModelPromptLimit || 0;
		const globalPerModelWindow = cfg?.globalPerModelPromptLimitWindow || '30m';

		for (const tm of todayModels) {
			if (!tm.model) continue;
			const teaseDefault =
				!limitKey.isTrial && isAddonTeaseModel(tm.model) && activeAddons.length === 0
					? ADDON_TEASE_DEFAULT_PROMPT_LIMIT
					: 0;
			const mlCheck = await checkModelPromptLimit(
				promptScopeIds,
				tm.model,
				perKeyDefault,
				perKeyWindow,
				globalPerModel,
				globalPerModelWindow,
				{ teaseDefaultLimit: teaseDefault },
			);
			const windowStr = perKeyWindow || globalPerModelWindow;
			const windowMs = parseRateLimitWindow(windowStr);
			const resetMs = await getWindowResetMs(promptScopeIds, windowMs, tm.model);
			if (mlCheck.used > 0 || mlCheck.effectiveLimit > 0) {
				modelUsageLimits.push({
					model: tm.model,
					used: mlCheck.used,
					limit: mlCheck.effectiveLimit,
					window: windowStr,
					remaining: rem(mlCheck.effectiveLimit, mlCheck.used),
					resetAt: resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null,
					source:
						mlCheck.source === 'tease_default'
							? 'global'
							: mlCheck.source === 'override'
								? 'global'
								: perModelPick.source,
				});
			}
		}

		const activeModelLimits = await db
			.select()
			.from(modelLimits)
			.where(eq(modelLimits.scope, 'global'));
		for (const am of activeModelLimits) {
			if (!modelUsageLimits.find((m) => m.model === am.model) && (am.promptLimit || 0) > 0) {
				modelUsageLimits.push({
					model: am.model,
					used: 0,
					limit: am.promptLimit || 0,
					window: perKeyWindow || globalPerModelWindow,
					remaining: rem(am.promptLimit || 0, 0),
					resetAt: null,
					source: 'global',
				});
			}
		}
	}

	return {
		scope,
		accountKeyCount: keyIds.length,
		usageToday: {
			requests: usageToday?.requests || 0,
			hopCount,
			promptTokens,
			billablePromptTokens,
			cachedTokens,
			fullInputTokens,
			completionTokens,
			totalTokens,
			promptCount: promptUsed,
			apiCallCount: apiCallUsed,
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
			promptLimit,
			promptLimitWindow,
			promptLimitSource,
			apiCallLimit,
			apiCallLimitWindow,
			apiCallLimitSource,
			perModelPromptLimit: perModelPick.value,
			perModelPromptLimitWindow: perModelWindow,
			perModelPromptLimitSource: perModelPick.source,
		},
		remaining: {
			input: stack.bypassIo ? null : rem(dailyInput.value, promptTokens),
			output: stack.bypassIo ? null : rem(dailyOutput.value, completionTokens),
			daily: rem(dailyTok.value, totalTokens),
			monthly: rem(monthly.value, monthTokens),
			prompt: rem(promptLimit, promptUsed),
			apiCalls: rem(apiCallLimit, apiCallUsed),
		},
		dailyResetAt,
		monthlyResetAt,
		promptResetAt,
		promptResetMins,
		apiCallResetAt,
		apiCallResetMins,
		modelUsageLimits,
		dailyTokenBreakdown,
		activeAddons: activeAddonsSummary,
		addonModelTokenCaps,
		perModelPromptsBypassedByAddon,
	};
}
