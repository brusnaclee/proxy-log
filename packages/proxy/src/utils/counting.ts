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
 * Per-turn token aggregation helpers.
 *
 * Problem: Each tool call within a turn re-sends the full conversation history
 * as prompt tokens. SUM(prompt_tokens) across all requests counts the same
 * context window multiple times (3.27x inflation on average).
 *
 * Solution: For input tokens, use context_delta_tokens which represents only
 * the NEW tokens added since the last request (user message + tool results).
 * This excludes system prompt and conversation history.
 *
 * Compact cycles: IDE/agent compact drops context (negative delta) then rebuilds
 * it (positive delta). Summing only positive deltas double-counts every rebuild.
 * Bill GREATEST(0, SUM(all deltas)) per turn so compact↔rebuild nets out.
 *
 * For output tokens, SUM(completion_tokens) across all requests in the turn
 * since each tool call produces genuinely new output.
 */

/**
 * Raw SQL fragment used inside GROUP BY turn_id subqueries.
 * Prefer this over SUM(positive-only) everywhere stats/limits are computed.
 */
export const TURN_NET_INPUT_DELTA_SQL = `GREATEST(0, COALESCE(SUM(context_delta_tokens), 0))`;

/** Turn-based request count: COUNT(DISTINCT turn_id) */
export function turnCountSql(whereCondition: SQL | undefined): SQL<number> {
  return sql<number>`(SELECT COUNT(DISTINCT turn_id) FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL)`;
}

/**
 * Turn-based input tokens: net context growth per turn (compacts cancel rebuilds).
 * context_delta_tokens = change since last request (can be negative on compact).
 */
export function turnPromptTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { input } = getTokenMultipliers(opts);
  return sql<number>`COALESCE((SELECT SUM(sum_delta) * ${input} FROM (SELECT GREATEST(0, COALESCE(SUM(context_delta_tokens), 0)) as sum_delta FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/** Turn-based completion tokens: SUM(completion) per turn, then SUM across turns */
export function turnCompletionTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { output } = getTokenMultipliers(opts);
  return sql<number>`COALESCE((SELECT SUM(sum_c) * ${output} FROM (SELECT SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/** Turn-based total tokens: (input + output) per turn, then SUM */
export function turnTotalTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const { input, output } = getTokenMultipliers(opts);
  return sql<number>`COALESCE((SELECT SUM(sum_delta * ${input} + sum_c * ${output}) FROM (SELECT GREATEST(0, COALESCE(SUM(context_delta_tokens), 0)) as sum_delta, SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
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
