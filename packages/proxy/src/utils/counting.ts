import { sql, type SQL } from "drizzle-orm";

/** Rows that count toward user prompt usage. */
export const COUNTED_LOG_SQL = sql`is_counted_request IS NOT 0 AND status_code BETWEEN 200 AND 299`;

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
 * Solution: For each turn, take MAX(prompt_tokens) as the input (the final
 * context size) and SUM(completion_tokens) as the output (each tool call
 * produces genuinely new output). Then sum across turns.
 */

/** Turn-based request count: COUNT(DISTINCT turn_id) */
export function turnCountSql(whereCondition: SQL): SQL<number> {
  return sql<number>`(SELECT COUNT(DISTINCT turn_id) FROM request_logs WHERE ${whereCondition} AND turn_id IS NOT NULL)`;
}

/** Turn-based prompt tokens: MAX(prompt) per turn, then SUM across turns */
export function turnPromptTokensSql(whereCondition: SQL): SQL<number> {
  return sql<number>`COALESCE((SELECT SUM(max_p) FROM (SELECT MAX(prompt_tokens) as max_p FROM request_logs WHERE ${whereCondition} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/** Turn-based completion tokens: SUM(completion) per turn, then SUM across turns */
export function turnCompletionTokensSql(whereCondition: SQL): SQL<number> {
  return sql<number>`COALESCE((SELECT SUM(sum_c) FROM (SELECT SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/** Turn-based total tokens: (MAX(prompt) + SUM(completion)) per turn, then SUM */
export function turnTotalTokensSql(whereCondition: SQL): SQL<number> {
  return sql<number>`COALESCE((SELECT SUM(max_p + sum_c) FROM (SELECT MAX(prompt_tokens) as max_p, SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
}

/** WIB midnight as SQLite datetime string (UTC storage). */
export function wibTodayStartSql(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset).toISOString().replace("T", " ").substring(0, 19);
}

/** WIB calendar month start as SQLite datetime string. */
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
export const RESOLVE_AUTO_MODEL_SQL = sql`CASE WHEN model LIKE 'auto (%)%' THEN TRIM(SUBSTR(model, 7, INSTR(SUBSTR(model, 7), ')') - 1)) ELSE model END`;
