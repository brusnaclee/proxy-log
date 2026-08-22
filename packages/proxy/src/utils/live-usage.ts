/**
 * Live daily/monthly/prompt usage + remaining — portal /me semantics for admin.
 * Usage is account-scoped when Discord-linked; limits come from the viewed key
 * (so per-key overrides show correctly on Key Detail / Keys list rows).
 */

import { and, eq, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiKeys, adminConfig, requestLogs } from '../db/schema.js';
import {
	BILLABLE_LOG_SQL,
	turnCountSql,
	peakPromptTokensSql,
	turnCompletionTokensSql,
	turnDisplayCompletionTokensSql,
	turnBillablePromptTokensSql,
	turnCachedTokensSql,
	hopCountSql,
	hopFullInputTokensSql,
	weightedHopInputTokensSql,
	weightedHopTotalTokensSql,
	wibMonthStartSql,
	sanitizeRows,
} from './counting.js';
import { resolveKeyApiCallLimit, resolveKeyPromptLimit } from './trial-config.js';
import {
	applyDayOverrideToPromptLimit,
	applyDayOverrideToQuotaStack,
	applyDayOverrideToRateLimit,
	getKeyDayOverride,
	normalizeDayBonuses,
} from './day-override.js';
import {
	checkApiCallLimit,
	checkPromptLimit,
	parseRateLimitWindow,
	listDedicatedQuotaRules,
	sqlExcludeDedicatedModels,
	sqlMatchDedicatedRule,
	resolveFixedWindow,
} from './rate-limit.js';
import {
	emptyInputLimitBreakdown,
	fetchInputLimitBreakdown,
	type InputLimitBreakdown,
} from './usage-input-breakdown.js';
import {
	getActiveAddonsForUser,
	parseModelDailyLimits,
	resolveAddonQuotaStack,
	sumAddonDailyTokenBonus,
} from './addons.js';
import { buildModelPromptUsage } from './model-prompt-usage.js';

export type LimitSource = 'override' | 'global' | 'none' | 'addon';

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
		/** Graduated hop input — same as daily input gate / bar. */
		promptTokens: number;
		/** Per-turn peak In (informational). */
		peakPromptTokens?: number;
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
	/** Fixed window start (ISO) when active; null if unused/expired. */
	promptWindowStart: string | null;
	apiCallResetAt: string | null;
	apiCallResetMins: number;
	rateWindowStart: string | null;
	/** Hop-weighted input math from today's logs (shared Discord/portal/admin). */
	inputBreakdown: import('./usage-input-breakdown.js').InputLimitBreakdown;
	modelUsageLimits: ModelPromptUsage[];
	/** When add-on active: input base + pack breakdown for UI */
	dailyTokenBreakdown?: {
		base: number;
		addonBonus: number;
		effective: number;
		bypassIo?: boolean;
		inputBase?: number;
		outputBase?: number;
		dailyTotal?: number;
	};
	activeAddons?: Array<{
		name: string;
		expiresAt: string | null;
		dailyTokenLimit: number;
	}>;
	/** Pack per-model token subcaps (not prompt caps) */
	addonModelTokenCaps?: Array<{ pattern: string; dailyLimit: number }>;
	perModelPromptsBypassedByAddon?: boolean;
	/** Dedicated model pools (outside account daily/input/output) */
	dedicatedPools?: Array<{
		model: string;
		isPattern: boolean;
		scope: string;
		limit: number;
		used: number;
		remaining: number;
		resetAt: string;
		/** Optional per-pool I/O caps (0 = not set; total-only pool) */
		inputLimit?: number;
		outputLimit?: number;
		/** Hop-weighted input (same schedule as account input gate). */
		inputUsed?: number;
		outputUsed?: number;
		/** SUM(prompt+cache) every hop — amanai / provider In style for this pool. */
		fullInputTokens?: number;
		/** Shared group name if this pool aggregates multiple models. */
		poolGroup?: string | null;
	}>;
	roleLimitMode?: string;
	blockedWithoutAddon?: boolean;
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

	const dedicatedRules = await listDedicatedQuotaRules(limitKey.id);
	const excludeDedicated = sqlExcludeDedicatedModels(dedicatedRules);
	const whereTodayHopsShared = and(whereTodayHops, excludeDedicated)!;
	const whereTodayShared = and(whereToday, excludeDedicated)!;

	const [usageToday, usageMonth, limitUsageToday] = await Promise.all([
		db
			.select({
				requests: turnCountSql(whereToday),
				hopCount: hopCountSql(whereTodayHops),
				/** Peak In (display note) — not used for the input limit bar. */
				peakPromptTokens: peakPromptTokensSql(whereToday, tmOpts),
				/** Hop-weighted input — same as daily input gate (excl. dedicated pools). */
				promptTokens: weightedHopInputTokensSql(whereTodayHopsShared, tmOpts),
				billablePromptTokens: turnBillablePromptTokensSql(whereTodayShared, tmOpts),
				cachedTokens: turnCachedTokensSql(whereTodayShared, tmOpts),
				fullInputTokens: hopFullInputTokensSql(whereTodayHopsShared, tmOpts),
				completionTokens: turnDisplayCompletionTokensSql(whereTodayHopsShared, tmOpts),
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
				tokens: weightedHopTotalTokensSql(whereTodayHopsShared, tmOpts),
			})
			.from(requestLogs)
			.where(whereTodayHopsShared)
			.then((r) => r[0]),
	]);

	const promptTokens = usageToday?.promptTokens || 0;
	const peakPromptTokens = usageToday?.peakPromptTokens || 0;
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
	const blockedWithoutAddon =
		!limitKey.isTrial &&
		String((limitKey as any).roleLimitMode || "").trim() === "zero_unless_addon" &&
		activeAddons.length <= 0;
	const addonDailyBonus = sumAddonDailyTokenBonus(activeAddons);

	const monthly = pickLimit(limitKey.monthlyTokenLimit, cfg?.globalMonthlyTokenLimit);
	const hasActiveAddon = activeAddons.length > 0;
	const dayBonuses = normalizeDayBonuses(await getKeyDayOverride(limitKey.id));
	const stack = applyDayOverrideToQuotaStack(
		resolveAddonQuotaStack({
			hasActiveAddon,
			isTrial: !!limitKey.isTrial,
			roleLimitMode: (limitKey as any).roleLimitMode,
			keyDailyInput: limitKey.dailyInputTokenLimit,
			keyDailyOutput: limitKey.dailyOutputTokenLimit,
			keyDailyTotal: limitKey.dailyTokenLimit,
			globalDailyInput: cfg?.globalDailyInputTokenLimit,
			globalDailyOutput: cfg?.globalDailyOutputTokenLimit,
			addonDailyBonus,
		}),
		dayBonuses,
	);

	const inputSource: LimitSource =
		Number(limitKey.dailyInputTokenLimit) > 0
			? "override"
			: stack.dailyInputLimit > 0
				? stack.addonBonus > 0 && stack.inputBase <= 0
					? "addon"
					: "global"
				: "none";
	const outputSource: LimitSource =
		Number(limitKey.dailyOutputTokenLimit) > 0
			? "override"
			: stack.dailyOutputLimit > 0
				? "global"
				: "none";

	const dailyInput = {
		value: stack.dailyInputLimit,
		source:
			dayBonuses.extraDailyInput > 0 && stack.dailyInputLimit > 0
				? ("override" as LimitSource)
				: inputSource,
	};
	const dailyOutput = {
		value: stack.dailyOutputLimit,
		source:
			dayBonuses.extraDailyOutput > 0 && stack.dailyOutputLimit > 0
				? ("override" as LimitSource)
				: outputSource,
	};
	const dailyTokenLimit = stack.effectiveDaily;
	const dailyTok =
		dailyTokenLimit > 0
			? {
					value: dailyTokenLimit,
					source: (Number(limitKey.dailyTokenLimit) > 0
						? "override"
						: limitKey.isTrial
							? "global"
							: "none") as LimitSource,
				}
			: { value: 0, source: "none" as LimitSource };

	const dailyTokenBreakdown = {
		base: stack.inputBase,
		addonBonus: stack.addonBonus,
		effective: stack.dailyInputLimit,
		bypassIo: false,
		inputBase: stack.inputBase,
		outputBase: stack.outputBase,
		/** Hard daily total (custom only); 0 = unlimited */
		dailyTotal: stack.effectiveDaily,
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

	const resolvedPrompt = resolveKeyPromptLimit(limitKey as any, cfg);
	const promptLimit = applyDayOverrideToPromptLimit(resolvedPrompt.limit, dayBonuses);
	const promptLimitWindow = resolvedPrompt.window;
	const promptLimitSource: LimitSource =
		promptLimit > 0
			? Number(limitKey.promptLimit) > 0 || dayBonuses.extraPromptLimit > 0
				? 'override'
				: 'global'
			: 'none';

	const resolvedApi = resolveKeyApiCallLimit(limitKey as any, cfg);
	const apiCallLimit = applyDayOverrideToRateLimit(resolvedApi.limit, dayBonuses);
	const apiCallLimitWindow = resolvedApi.window;
	const apiCallLimitSource: LimitSource =
		apiCallLimit > 0
			? Number(limitKey.rateLimit) > 0 || dayBonuses.extraRateLimit > 0
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
	const promptWindowStartRaw = limitKey.promptWindowStart || null;
	const rateWindowStartRaw = limitKey.rateWindowStart || null;
	let promptWindowStart: string | null = null;
	let rateWindowStart: string | null = null;

	if (promptLimit > 0 && promptScopeIds.length > 0) {
		const plCheck = await checkPromptLimit(
			promptScopeIds,
			promptLimit,
			promptLimitWindow,
			promptWindowStartRaw,
		);
		promptUsed = plCheck.used;
		promptResetMins = Math.ceil(plCheck.resetMs / 60000);
		promptResetAt =
			plCheck.resetMs > 0 ? new Date(Date.now() + plCheck.resetMs).toISOString() : null;
		const pwMs = parseRateLimitWindow(promptLimitWindow);
		const fixed = resolveFixedWindow(promptWindowStartRaw, pwMs);
		if (fixed.active && fixed.windowStartMs) {
			promptWindowStart = new Date(fixed.windowStartMs).toISOString();
		}
	}

	let apiCallUsed = 0;
	let apiCallResetAt: string | null = null;
	let apiCallResetMins = 0;
	if (apiCallLimit > 0 && promptScopeIds.length > 0) {
		const acCheck = await checkApiCallLimit(
			promptScopeIds,
			apiCallLimit,
			apiCallLimitWindow,
			rateWindowStartRaw,
		);
		apiCallUsed = acCheck.used;
		apiCallResetMins = Math.ceil(acCheck.resetMs / 60000);
		apiCallResetAt =
			acCheck.resetMs > 0 ? new Date(Date.now() + acCheck.resetMs).toISOString() : null;
		const awMs = parseRateLimitWindow(apiCallLimitWindow);
		const fixed = resolveFixedWindow(rateWindowStartRaw, awMs);
		if (fixed.active && fixed.windowStartMs) {
			rateWindowStart = new Date(fixed.windowStartMs).toISOString();
		}
	}

	let inputBreakdown: InputLimitBreakdown = emptyInputLimitBreakdown();
	try {
		inputBreakdown = await fetchInputLimitBreakdown(whereTodayHopsShared);
	} catch (err) {
		console.warn('[live-usage] input breakdown failed:', (err as Error)?.message || err);
	}

	const modelUsageLimits: ModelPromptUsage[] = await buildModelPromptUsage({
		scopeIds: promptScopeIds,
		isTrial: !!limitKey.isTrial,
		hasActiveAddons: activeAddons.length > 0,
		perKeyDefaultLimit: limitKey.perModelPromptLimit || 0,
		perKeyDefaultWindow: limitKey.perModelPromptLimitWindow || null,
		globalDefaultLimit: cfg?.globalPerModelPromptLimit || 0,
		globalDefaultWindow: cfg?.globalPerModelPromptLimitWindow || '1d',
	});

	const dedicatedPools: NonNullable<LiveUsagePayload['dedicatedPools']> = [];
	if (!blockedWithoutAddon && dedicatedRules.length > 0) {
		const groupAgg = new Map<string, { used: number; input: number; output: number; fullInput: number; limit: number; inputLimit: number; outputLimit: number; members: string[] }>();
		for (const rule of dedicatedRules) {
			const wherePool = and(
				inArray(requestLogs.apiKeyId, keyIds),
				sql`created_at >= ${todayStart}`,
				BILLABLE_LOG_SQL,
				sqlMatchDedicatedRule(rule),
			)!;
			const usedRow = await db
				.select({
					total: weightedHopTotalTokensSql(wherePool, tmOpts),
					input: weightedHopInputTokensSql(wherePool, tmOpts),
					output: turnCompletionTokensSql(wherePool, tmOpts),
					fullInput: hopFullInputTokensSql(wherePool, tmOpts),
				})
				.from(requestLogs)
				.where(wherePool)
				.then((r) => r[0]);
			const used = Number(usedRow?.total) || 0;
			const inputUsed = Number(usedRow?.input) || 0;
			const outputUsed = Number(usedRow?.output) || 0;
			const fullInput = Number(usedRow?.fullInput) || 0;
			const limit = rule.dailyTokenLimit || 0;
			const inputLimit = rule.dailyInputTokenLimit || 0;
			const outputLimit = rule.dailyOutputTokenLimit || 0;
			const groupName = rule.dedicatedPoolGroup?.trim();

			if (!groupName) {
				dedicatedPools.push({
					model: rule.model,
					isPattern: !!rule.isPattern,
					scope: rule.scope,
					limit,
					used,
					remaining: Math.max(0, limit - used),
					resetAt: dailyResetAt,
					inputLimit,
					outputLimit,
					inputUsed,
					outputUsed,
					fullInputTokens: fullInput,
					poolGroup: null,
				});
			} else {
				const agg = groupAgg.get(groupName) || {
					used: 0,
					input: 0,
					output: 0,
					fullInput: 0,
					limit,
					inputLimit,
					outputLimit,
					members: [],
				};
				agg.used += used;
				agg.input += inputUsed;
				agg.output += outputUsed;
				agg.fullInput += fullInput;
				agg.limit = Math.max(agg.limit, limit);
				agg.inputLimit = Math.max(agg.inputLimit, inputLimit);
				agg.outputLimit = Math.max(agg.outputLimit, outputLimit);
				agg.members.push(rule.model);
				groupAgg.set(groupName, agg);
			}
		}
		for (const [groupName, agg] of groupAgg) {
			const membersLabel = agg.members.length <= 2
				? agg.members.join(" + ")
				: `${agg.members[0]} +${agg.members.length - 1}`;
			dedicatedPools.push({
				model: `${groupName} (shared: ${membersLabel})`,
				isPattern: false,
				scope: "global",
				limit: agg.limit,
				used: agg.used,
				remaining: Math.max(0, agg.limit - agg.used),
				resetAt: dailyResetAt,
				inputLimit: agg.inputLimit,
				outputLimit: agg.outputLimit,
				inputUsed: agg.input,
				outputUsed: agg.output,
				fullInputTokens: agg.fullInput,
				poolGroup: groupName,
			});
		}
	}

	if (blockedWithoutAddon) {
		return {
			scope,
			accountKeyCount: keyIds.length,
			usageToday: {
				requests: usageToday?.requests || 0,
				hopCount,
				promptTokens,
				peakPromptTokens,
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
				dailyTokenLimit: 0,
				dailyTokenLimitSource: 'none',
				dailyInputTokenLimit: 0,
				dailyInputTokenLimitSource: 'none',
				dailyOutputTokenLimit: 0,
				dailyOutputTokenLimitSource: 'none',
				monthlyTokenLimit: 0,
				monthlyTokenLimitSource: 'none',
				promptLimit: 0,
				promptLimitWindow,
				promptLimitSource: 'none',
				apiCallLimit: 0,
				apiCallLimitWindow,
				apiCallLimitSource: 'none',
				perModelPromptLimit: 0,
				perModelPromptLimitWindow: perModelWindow,
				perModelPromptLimitSource: 'none',
			},
			remaining: {
				input: 0,
				output: 0,
				daily: 0,
				monthly: 0,
				prompt: 0,
				apiCalls: 0,
			},
			dailyResetAt,
			monthlyResetAt,
			promptResetAt: null,
			promptResetMins: 0,
			promptWindowStart: null,
			apiCallResetAt: null,
			apiCallResetMins: 0,
			rateWindowStart: null,
			inputBreakdown: emptyInputLimitBreakdown(),
			modelUsageLimits: [],
			dailyTokenBreakdown: {
				base: 0,
				addonBonus: 0,
				effective: 0,
				bypassIo: false,
				inputBase: 0,
				outputBase: 0,
			},
			activeAddons: activeAddonsSummary,
			addonModelTokenCaps: [],
			perModelPromptsBypassedByAddon: false,
			dedicatedPools: [],
			roleLimitMode: 'zero_unless_addon',
			blockedWithoutAddon: true,
		};
	}

	return {
		scope,
		accountKeyCount: keyIds.length,
		usageToday: {
			requests: usageToday?.requests || 0,
			hopCount,
			promptTokens,
			peakPromptTokens,
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
			input: rem(dailyInput.value, promptTokens),
			output: rem(dailyOutput.value, completionTokens),
			daily: rem(dailyTok.value, totalTokens),
			monthly: rem(monthly.value, monthTokens),
			prompt: rem(promptLimit, promptUsed),
			apiCalls: rem(apiCallLimit, apiCallUsed),
		},
		dailyResetAt,
		monthlyResetAt,
		promptResetAt,
		promptResetMins,
		promptWindowStart,
		apiCallResetAt,
		apiCallResetMins,
		rateWindowStart,
		inputBreakdown,
		modelUsageLimits,
		dailyTokenBreakdown,
		activeAddons: activeAddonsSummary,
		addonModelTokenCaps,
		perModelPromptsBypassedByAddon,
		dedicatedPools,
	};
}
