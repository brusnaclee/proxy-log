import { sql, type SQL } from "drizzle-orm";
import { getTokenMultipliers, type TokenMultiplierOpts } from "./token-multiplier.js";

/**
 * PostgreSQL returns bigint/numeric columns as strings.
 * This converts string numbers to actual numbers.
 */
export function num(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Sanitize numeric fields in query result rows */
export function sanitizeRows<T extends Record<string, any>>(rows: T[], keys: string[]): T[] {
  return rows.map(row => {
    const s = { ...row };
    for (const k of keys) if (k in s) s[k] = num(s[k]);
    return s;
  });
}

/** Rows that count toward user prompt usage. */
export const COUNTED_LOG_SQL = sql`is_counted_request = true AND status_code BETWEEN 200 AND 299`;

/** Rows that count toward token billing (prompts + tool followups). */
export const BILLABLE_LOG_SQL = sql`status_code BETWEEN 200 AND 299`;

export const VALID_LOG_SQL = sql`status_code BETWEEN 200 AND 299`;

/**
 * Input accounting mode (admin_config.token_input_mode):
 * - per_turn_peak: MAX(prompt+cache) once per turn_id — fair for agents (default)
 * - full: SUM(prompt+cached) every hop — matches upstream In / amanai
 * - billable: net context_delta per turn (legacy)
 *
 * Multipliers (INPUT_TOKEN_MULTIPLIER / OUTPUT_TOKEN_MULTIPLIER) still apply
 * at read time on top of these raw sums.
 */
export type TokenInputMode = "per_turn_peak" | "full" | "billable";

let tokenInputModeCache: TokenInputMode = "per_turn_peak";

/** Percent of each hop's In+Out counted toward daily/monthly token LIMITS (logs stay 100%). */
let tokenLimitWeightPercentCache = 10;

export function normalizeTokenLimitWeightPercent(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(100, n));
}

export function setTokenLimitWeightPercentCache(percent: unknown): void {
  tokenLimitWeightPercentCache = normalizeTokenLimitWeightPercent(percent);
}

export function getTokenLimitWeightPercentSync(): number {
  return tokenLimitWeightPercentCache;
}

export function normalizeTokenInputMode(raw: unknown): TokenInputMode {
  const m = String(raw || "per_turn_peak").toLowerCase().trim();
  if (m === "full") return "full";
  if (m === "billable") return "billable";
  return "per_turn_peak";
}

export function setTokenInputModeCache(mode: TokenInputMode | unknown): void {
  tokenInputModeCache = normalizeTokenInputMode(mode);
}

export function getTokenInputModeSync(): TokenInputMode {
  return tokenInputModeCache;
}

/**
 * SQL expr for input inside GROUP BY turn_id — mode-aware.
 * Outer queries SUM() these per-turn values.
 */
export function groupedInputSumSql(): string {
  if (tokenInputModeCache === "billable") {
    return `GREATEST(0, COALESCE(SUM(context_delta_tokens), 0))`;
  }
  if (tokenInputModeCache === "full") {
    return `COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)), 0)`;
  }
  // per_turn_peak: one full-In snapshot per user prompt (tool hops don't multiply)
  return `COALESCE(MAX(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)), 0)`;
}

/** @deprecated use groupedInputSumSql() */
export const TURN_NET_INPUT_DELTA_SQL = `GREATEST(0, COALESCE(SUM(context_delta_tokens), 0))`;

/** Per-row helpers for API/UI mappers (no multiplier). */
export function rowInputTokens(promptTokens: number, cachedTokens: number): number {
  return Math.max(0, num(promptTokens)) + Math.max(0, num(cachedTokens));
}

export function rowDisplayTotal(promptTokens: number, cachedTokens: number, completionTokens: number): number {
  return rowInputTokens(promptTokens, cachedTokens) + Math.max(0, num(completionTokens));
}

/** Turn-based request count: COUNT(DISTINCT turn_id) */
export function turnCountSql(whereCondition: SQL | undefined): SQL<number> {
  return sql<number>`(SELECT COUNT(DISTINCT turn_id) FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL)`;
}

/**
 * Input tokens for limits/stats (× INPUT_TOKEN_MULTIPLIER).
 */
export function turnPromptTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { input } = getTokenMultipliers(opts);
  if (tokenInputModeCache === "full") {
    return sql<number>`COALESCE((SELECT SUM(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${input} FROM request_logs WHERE ${whereCondition!}), 0)`;
  }
  if (tokenInputModeCache === "billable") {
    return sql<number>`COALESCE((SELECT SUM(sum_delta) * ${input} FROM (SELECT GREATEST(0, COALESCE(SUM(context_delta_tokens), 0)) as sum_delta FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
  }
  // per_turn_peak
  return sql<number>`COALESCE((SELECT SUM(peak) * ${input} FROM (SELECT MAX(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) as peak FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/** Billable prompt only (excludes cache), × input multiplier. Peak mode: from peak hop per turn. */
export function turnBillablePromptTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { input } = getTokenMultipliers(opts);
  if (tokenInputModeCache === "per_turn_peak") {
    return sql<number>`COALESCE((SELECT SUM(p) * ${input} FROM (
      SELECT DISTINCT ON (turn_id) COALESCE(prompt_tokens, 0) as p
      FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL
      ORDER BY turn_id, (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC
    ) t), 0)`;
  }
  return sql<number>`COALESCE((SELECT SUM(COALESCE(prompt_tokens, 0)) * ${input} FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/** Cached tokens sum, × input multiplier. Peak mode: from peak hop per turn. */
export function turnCachedTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { input } = getTokenMultipliers(opts);
  if (tokenInputModeCache === "per_turn_peak") {
    return sql<number>`COALESCE((SELECT SUM(c) * ${input} FROM (
      SELECT DISTINCT ON (turn_id) COALESCE(cached_tokens, 0) as c
      FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL
      ORDER BY turn_id, (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC
    ) t), 0)`;
  }
  return sql<number>`COALESCE((SELECT SUM(COALESCE(cached_tokens, 0)) * ${input} FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/** Completion tokens: SUM(completion) per turn, then SUM × OUTPUT multiplier */
export function turnCompletionTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { output } = getTokenMultipliers(opts);
  return sql<number>`COALESCE((SELECT SUM(sum_c) * ${output} FROM (SELECT SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/** Total: mode-aware input + completion, with multipliers. */
export function turnTotalTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { input, output } = getTokenMultipliers(opts);
  if (tokenInputModeCache === "full") {
    return sql<number>`COALESCE((SELECT SUM((COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${input} + COALESCE(completion_tokens, 0) * ${output}) FROM request_logs WHERE ${whereCondition!}), 0)`;
  }
  if (tokenInputModeCache === "billable") {
    return sql<number>`COALESCE((SELECT SUM(sum_delta * ${input} + sum_c * ${output}) FROM (SELECT GREATEST(0, COALESCE(SUM(context_delta_tokens), 0)) as sum_delta, SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
  }
  // per_turn_peak
  return sql<number>`COALESCE((SELECT SUM(peak * ${input} + sum_c * ${output}) FROM (SELECT MAX(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) as peak, SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/**
 * Upstream-style full input: SUM(prompt+cache) every hop (amanai / provider In).
 * Independent of token_input_mode — for admin comparison only.
 */
export function hopFullInputTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { input } = getTokenMultipliers(opts);
  return sql<number>`COALESCE((SELECT SUM(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${input} FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/**
 * Token LIMIT usage: every hop counts, but only weight% of (In+Out) is charged to the quota.
 * Example weight=10 → 100 hops × 10k In ≈ 100k toward daily limit (not 1M full, not peak-only).
 * request_logs still store full tokens; this is gate / limit-bar only.
 */
export function weightedHopTotalTokensSql(
  whereCondition: SQL | undefined,
  opts?: TokenMultiplierOpts,
): SQL<number> {
  const { input, output } = getTokenMultipliers(opts);
  const w = tokenLimitWeightPercentCache / 100;
  return sql<number>`COALESCE((SELECT SUM(
    (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${input} * ${w}
    + COALESCE(completion_tokens, 0) * ${output} * ${w}
  ) FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/** Raw API hop count (every upstream call), not turn/prompt count. */
export function hopCountSql(whereCondition: SQL | undefined): SQL<number> {
  return sql<number>`(SELECT COUNT(*) FROM request_logs WHERE ${whereCondition!})`;
}

/** WIB midnight as PostgreSQL datetime string (UTC storage). */
export function wibTodayStartSql(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset).toISOString().replace("T", " ").substring(0, 19);
}

/** WIB calendar month start as PostgreSQL datetime string. */
export function wibMonthStartSql(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCDate(1);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset).toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Model name normalization for auto-model routing.
 *
 * When a user sends model="auto", the proxy resolves it to a specific model
 * (e.g., "auto (qwen-flash) [stream]"). For leaderboard display:
 * - "auto" entries should show as "auto" in the leaderboard
 * - The underlying model (e.g., qwen-flash) should also be counted separately
 */

/** SQL expression: normalize "auto (model) [stream]" to "auto" */
export const NORMALIZE_MODEL_SQL = sql`CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END`;

/** SQL expression: extract underlying model from "auto (model) [stream]" */
export const RESOLVE_AUTO_MODEL_SQL = sql`CASE WHEN model LIKE 'auto (%)%' THEN TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) ELSE model END`;

// ─── Period Range Helper (WIB-based) ──────────────────────────────────────────

export type PeriodKey = "today" | "3d" | "7d" | "30d" | "thisMonth" | "lastMonth" | "allTime";

/**
 * Resolve a period key to a { start, end } date range based on WIB (UTC+7).
 * Returns null for end when "allTime" (no upper bound).
 */
export function resolvePeriodRange(period: PeriodKey): { start: Date; end: Date | null } {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);

  // WIB today midnight in UTC
  const wibMidnight = new Date(wibNow);
  wibMidnight.setUTCHours(0, 0, 0, 0);
  const todayUtcMidnight = new Date(wibMidnight.getTime() - wibOffset);

  switch (period) {
    case "today": {
      return { start: todayUtcMidnight, end: now };
    }
    case "3d": {
      const start = new Date(todayUtcMidnight.getTime() - 2 * 86400000);
      return { start, end: now };
    }
    case "7d": {
      const start = new Date(todayUtcMidnight.getTime() - 6 * 86400000);
      return { start, end: now };
    }
    case "30d": {
      const start = new Date(todayUtcMidnight.getTime() - 29 * 86400000);
      return { start, end: now };
    }
    case "thisMonth": {
      const monthStart = new Date(todayUtcMidnight);
      monthStart.setUTCDate(1);
      return { start: new Date(monthStart.getTime() - wibOffset), end: now };
    }
    case "lastMonth": {
      const prevMonth = new Date(todayUtcMidnight);
      prevMonth.setUTCDate(1);
      prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
      const monthEnd = new Date(todayUtcMidnight);
      monthEnd.setUTCDate(1);
      return {
        start: new Date(prevMonth.getTime() - wibOffset),
        end: new Date(monthEnd.getTime() - wibOffset),
      };
    }
    case "allTime":
    default: {
      return { start: new Date(0), end: null };
    }
  }
}

/** All available period options for the period selector UI. */
export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "3d",        label: "3 Days" },
  { key: "7d",         label: "7 Days" },
  { key: "30d",       label: "30 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "allTime",   label: "All Time" },
];

/** Map period to chart days for timeseries granularity. */
export function chartDaysForPeriod(period: PeriodKey): number {
  switch (period) {
    case "today":     return 1;
    case "3d":        return 3;
    case "7d":        return 7;
    case "30d":       return 30;
    case "thisMonth":
    case "lastMonth": return 60;
    case "allTime":   return 90;
  }
}
