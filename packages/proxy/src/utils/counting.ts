import { sql, type SQL } from "drizzle-orm";
import {
  getTokenMultipliers,
  sqlMultiplierExpr,
  type TokenMultiplierOpts,
} from "./token-multiplier.js";
import {
  type TokenLimitWeightMode,
  type HopWeightRange,
  normalizeTokenLimitWeightMode,
  normalizeTokenLimitWeightPercent,
  normalizeHopWeightRanges,
  serializeHopWeightRanges,
  inputLimitWeightPercentForHop as hopWeightPercent,
} from "./hop-weight.js";

export type { TokenLimitWeightMode, HopWeightRange };
export {
  normalizeTokenLimitWeightMode,
  normalizeTokenLimitWeightPercent,
  normalizeHopWeightRanges,
  serializeHopWeightRanges,
};

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
 * Input accounting mode (admin_config.token_input_mode) — stats tables / Discord peak-view note.
 * Daily LIMIT credit uses token_limit_weight_* (see weightedHop*Sql), not this mode.
 */
export type TokenInputMode = "per_turn_peak" | "full" | "billable";

let tokenInputModeCache: TokenInputMode = "per_turn_peak";
let tokenLimitWeightModeCache: TokenLimitWeightMode = "first_rest_flat";
let tokenLimitWeightPercentCache = 100;
let tokenLimitWeightCustomCache: HopWeightRange[] = [];

export function setTokenLimitWeightPercentCache(percent: unknown): void {
  tokenLimitWeightPercentCache = normalizeTokenLimitWeightPercent(percent);
}

export function getTokenLimitWeightPercentSync(): number {
  return tokenLimitWeightPercentCache;
}

export function setTokenLimitWeightModeCache(mode: unknown): void {
  tokenLimitWeightModeCache = normalizeTokenLimitWeightMode(mode);
}

export function getTokenLimitWeightModeSync(): TokenLimitWeightMode {
  return tokenLimitWeightModeCache;
}

export function setTokenLimitWeightCustomCache(raw: unknown): void {
  tokenLimitWeightCustomCache = normalizeHopWeightRanges(raw);
}

export function getTokenLimitWeightCustomSync(): HopWeightRange[] {
  return tokenLimitWeightCustomCache;
}

/** Apply mode + flat% + custom ranges into caches (settings / boot). */
export function setTokenLimitWeightConfigCache(opts: {
  mode?: unknown;
  percent?: unknown;
  custom?: unknown;
}): void {
  if (opts.mode !== undefined) setTokenLimitWeightModeCache(opts.mode);
  if (opts.percent !== undefined) setTokenLimitWeightPercentCache(opts.percent);
  if (opts.custom !== undefined) setTokenLimitWeightCustomCache(opts.custom);
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
 * SQL expr for input inside GROUP BY turn_id — mode-aware (stats display).
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
 * Input tokens for stats display (× multipliers, per-model patterns) — respects token_input_mode.
 */
export function turnPromptTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  if (tokenInputModeCache === "full") {
    return sql<number>`COALESCE((SELECT SUM((COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${min}) FROM request_logs WHERE ${whereCondition!}), 0)`;
  }
  if (tokenInputModeCache === "billable") {
    // Turn-level billable has no single model; use global fallback via orphan model ''.
    const { input } = getTokenMultipliers(opts);
    return sql<number>`COALESCE((SELECT SUM(sum_delta) * ${input} FROM (SELECT GREATEST(0, COALESCE(SUM(context_delta_tokens), 0)) as sum_delta FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
  }
  // per_turn_peak — multiply using the peak hop's model
  return sql<number>`COALESCE((SELECT SUM(peak * ${min}) FROM (
    SELECT DISTINCT ON (turn_id)
      (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 as peak,
      model
    FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL
    ORDER BY turn_id, (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC, id ASC
  ) t), 0)`;
}

/** Always peak input (for admin notes), ignoring token_input_mode. */
export function peakPromptTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  return sql<number>`COALESCE((SELECT SUM(peak * ${min}) FROM (
    SELECT DISTINCT ON (turn_id)
      (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 as peak,
      model
    FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL
    ORDER BY turn_id, (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC, id ASC
  ) t), 0)`;
}

/** Billable prompt only (excludes cache), × input multiplier. Peak mode: from peak hop per turn. */
export function turnBillablePromptTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  if (tokenInputModeCache === "per_turn_peak") {
    return sql<number>`COALESCE((SELECT SUM(p * ${min}) FROM (
      SELECT DISTINCT ON (turn_id) COALESCE(prompt_tokens, 0)::float8 as p, model
      FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL
      ORDER BY turn_id, (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC, id ASC
    ) t), 0)`;
  }
  return sql<number>`COALESCE((SELECT SUM(COALESCE(prompt_tokens, 0) * ${min}) FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/** Cached tokens sum, × input multiplier. Peak mode: from peak hop per turn. */
export function turnCachedTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  if (tokenInputModeCache === "per_turn_peak") {
    return sql<number>`COALESCE((SELECT SUM(c * ${min}) FROM (
      SELECT DISTINCT ON (turn_id) COALESCE(cached_tokens, 0)::float8 as c, model
      FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL
      ORDER BY turn_id, (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC, id ASC
    ) t), 0)`;
  }
  return sql<number>`COALESCE((SELECT SUM(COALESCE(cached_tokens, 0) * ${min}) FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/** Completion tokens: per-hop × OUTPUT multiplier (pattern-aware). */
export function turnCompletionTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const mout = sql.raw(sqlMultiplierExpr("output", "model", opts));
  return sql<number>`COALESCE((SELECT SUM(COALESCE(completion_tokens, 0) * ${mout}) FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/** Total: mode-aware input + completion, with multipliers. */
export function turnTotalTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  const mout = sql.raw(sqlMultiplierExpr("output", "model", opts));
  if (tokenInputModeCache === "full") {
    return sql<number>`COALESCE((SELECT SUM((COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${min} + COALESCE(completion_tokens, 0) * ${mout}) FROM request_logs WHERE ${whereCondition!}), 0)`;
  }
  if (tokenInputModeCache === "billable") {
    const { input, output } = getTokenMultipliers(opts);
    return sql<number>`COALESCE((SELECT SUM(sum_delta * ${input} + sum_c * ${output}) FROM (SELECT GREATEST(0, COALESCE(SUM(context_delta_tokens), 0)) as sum_delta, SUM(completion_tokens) as sum_c FROM request_logs WHERE ${whereCondition!} AND turn_id IS NOT NULL GROUP BY turn_id)), 0)`;
  }
  // per_turn_peak input (peak hop model) + full completion per hop
  return sql<number>`(
    ${peakPromptTokensSql(whereCondition, opts)}
    + ${turnCompletionTokensSql(whereCondition, opts)}
  )`;
}

/**
 * Upstream-style full input: SUM(prompt+cache) every hop (amanai / provider In).
 * Independent of token_input_mode — for admin comparison only.
 */
export function hopFullInputTokensSql(whereCondition: SQL | undefined, opts?: TokenMultiplierOpts): SQL<number> {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  return sql<number>`COALESCE((SELECT SUM((COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${min}) FROM request_logs WHERE ${whereCondition!}), 0)`;
}

/**
 * Input % toward daily/monthly token LIMITS by hop index within a turn (1-based).
 * Uses current token_limit_weight_* cache.
 */
export function inputLimitWeightPercentForHop(rn: number): number {
  return hopWeightPercent(
    rn,
    tokenLimitWeightModeCache,
    tokenLimitWeightPercentCache,
    tokenLimitWeightCustomCache,
  );
}

/** SQL CASE expr for input weight fraction (0..1) given hop rn — rebuilt from cache. */
function inputHopWeightFractionSql(): SQL {
  return sql.raw(inputHopWeightSqlExpr());
}

/** Raw SQL fragment (no params) for hop weight fraction — safe: values are normalized numbers. */
export function inputHopWeightSqlExpr(): string {
  const mode = tokenLimitWeightModeCache;
  const flat = tokenLimitWeightPercentCache / 100;

  if (mode === "full") return "1.0";
  if (mode === "flat_all") return String(flat);
  if (mode === "peak") return "(CASE WHEN rn = 1 THEN 1.0 ELSE 0.0 END)";
  if (mode === "custom") {
    const ranges = tokenLimitWeightCustomCache;
    if (!ranges.length) return "0.0";
    const whens = ranges
      .map((r) => `WHEN rn BETWEEN ${r.fromHop} AND ${r.toHop} THEN ${r.percent / 100}`)
      .join(" ");
    return `(CASE ${whens} ELSE 0.0 END)`;
  }
  return `(CASE WHEN rn = 1 THEN 1.0 ELSE ${flat} END)`;
}

/**
 * INPUT credit toward daily input limit (× INPUT_TOKEN_MULTIPLIER).
 * Mode: first_rest_flat / flat_all / full / custom / peak.
 */
export function weightedHopInputTokensSql(
  whereCondition: SQL | undefined,
  opts?: TokenMultiplierOpts,
): SQL<number> {
  if (tokenLimitWeightModeCache === "peak") {
    return peakPromptTokensSql(whereCondition, opts);
  }
  if (tokenLimitWeightModeCache === "full") {
    return hopFullInputTokensSql(whereCondition, opts);
  }
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  const w = inputHopWeightFractionSql();
  return sql<number>`COALESCE((
    SELECT SUM(inn * (${w}) * ${min})
    FROM (
      SELECT
        (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
        model,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(turn_id, 'orphan-' || id::text)
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM request_logs
      WHERE ${whereCondition!}
    ) hops
  ), 0)`;
}

/**
 * Token LIMIT usage (fair agent billing) — logs stay full 100%.
 * - Input (+cache): hop schedule from token_limit_weight_*
 * - Output: always 100%
 */
export function weightedHopTotalTokensSql(
  whereCondition: SQL | undefined,
  opts?: TokenMultiplierOpts,
): SQL<number> {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  const mout = sql.raw(sqlMultiplierExpr("output", "model", opts));
  if (tokenLimitWeightModeCache === "peak") {
    return sql<number>`(
      ${peakPromptTokensSql(whereCondition, opts)}
      + ${turnCompletionTokensSql(whereCondition, opts)}
    )`;
  }
  if (tokenLimitWeightModeCache === "full") {
    return sql<number>`COALESCE((
      SELECT SUM(
        (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${min}
        + COALESCE(completion_tokens, 0) * ${mout}
      )
      FROM request_logs WHERE ${whereCondition!}
    ), 0)`;
  }
  const w = inputHopWeightFractionSql();
  return sql<number>`COALESCE((
    SELECT SUM(
      (inn * (${w})) * ${min}
      + outt * ${mout}
    )
    FROM (
      SELECT
        (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
        COALESCE(completion_tokens, 0)::float8 AS outt,
        model,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(turn_id, 'orphan-' || id::text)
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM request_logs
      WHERE ${whereCondition!}
    ) hops
  ), 0)`;
}

/** Raw API hop count (every upstream call), not turn/prompt count. */
export function hopCountSql(whereCondition: SQL | undefined): SQL<number> {
  return sql<number>`(SELECT COUNT(*) FROM request_logs WHERE ${whereCondition!})`;
}

/**
 * Hop-weighted limit-credit timeseries (same formula as {@link weightedHopTotalTokensSql} / gates).
 * `rn` is partitioned by turn across the whole window (not per bucket), so summing
 * bucket totals equals the period aggregate.
 *
 * @param groupExpr SQL expression for the bucket key (e.g. to_char(...))
 * @param whereExtra full WHERE body without leading WHERE
 */
export function hopWeightedTimeseriesSql(
  groupExpr: SQL,
  whereExtra: SQL,
  opts?: TokenMultiplierOpts,
): SQL {
  const min = sql.raw(sqlMultiplierExpr("input", "model", opts));
  const mout = sql.raw(sqlMultiplierExpr("output", "model", opts));

  // peak mode: only the max-context hop per turn contributes input credit
  if (tokenLimitWeightModeCache === "peak") {
    return sql`
      SELECT
        period_group as period,
        COUNT(DISTINCT turn_key)::int as requests,
        COALESCE(SUM(hop_count), 0)::int as "apiCalls",
        COALESCE(SUM(peak_in * ${min}), 0) as "promptTokens",
        COALESCE(SUM(out_sum * ${mout}), 0) as "completionTokens",
        COALESCE(SUM(peak_in * ${min} + out_sum * ${mout}), 0) as tokens
      FROM (
        SELECT
          ${groupExpr} as period_group,
          COALESCE(turn_id, 'orphan-' || id::text) as turn_key,
          COUNT(*)::int as hop_count,
          MAX(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 as peak_in,
          SUM(COALESCE(completion_tokens, 0))::float8 as out_sum,
          (ARRAY_AGG(model ORDER BY (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC, id ASC))[1] as model
        FROM request_logs
        WHERE ${whereExtra}
        GROUP BY ${groupExpr}, COALESCE(turn_id, 'orphan-' || id::text)
      ) turns
      GROUP BY period_group
      ORDER BY period_group
    `;
  }

  if (tokenLimitWeightModeCache === "full") {
    return sql`
      SELECT
        period_group as period,
        COUNT(DISTINCT turn_key)::int as requests,
        COUNT(*)::int as "apiCalls",
        COALESCE(SUM(inn * ${min}), 0) as "promptTokens",
        COALESCE(SUM(outt * ${mout}), 0) as "completionTokens",
        COALESCE(SUM(inn * ${min} + outt * ${mout}), 0) as tokens
      FROM (
        SELECT
          ${groupExpr} as period_group,
          COALESCE(turn_id, 'orphan-' || id::text) as turn_key,
          (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
          COALESCE(completion_tokens, 0)::float8 AS outt,
          model
        FROM request_logs
        WHERE ${whereExtra}
      ) hops
      GROUP BY period_group
      ORDER BY period_group
    `;
  }

  const w = inputHopWeightSqlExpr();
  return sql`
    SELECT
      period_group as period,
      COUNT(DISTINCT turn_key)::int as requests,
      COUNT(*)::int as "apiCalls",
      COALESCE(SUM(inn * (${sql.raw(w)}) * ${min}), 0) as "promptTokens",
      COALESCE(SUM(outt * ${mout}), 0) as "completionTokens",
      COALESCE(SUM(inn * (${sql.raw(w)}) * ${min} + outt * ${mout}), 0) as tokens
    FROM (
      SELECT
        ${groupExpr} as period_group,
        COALESCE(turn_id, 'orphan-' || id::text) as turn_key,
        (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
        COALESCE(completion_tokens, 0)::float8 AS outt,
        model,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(turn_id, 'orphan-' || id::text)
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM request_logs
      WHERE ${whereExtra}
    ) hops
    GROUP BY period_group
    ORDER BY period_group
  `;
}

/**
 * Display label for Top Models: `auto (gcli/grok-4.5) [stream]` → `auto → gcli/grok-4.5`.
 * Keeps non-auto ids unchanged.
 */
export const DISPLAY_MODEL_SQL_EXPR = `CASE WHEN model LIKE 'auto (%)%' THEN 'auto → ' || TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) ELSE model END`;

/**
 * Per-model limit-credit breakdown — same hop weights as {@link weightedHopTotalTokensSql}.
 * Summing `tokens` across models ≈ period Total (limit credit); summing `promptTokens` ≈ Input credit.
 * Auto routes are shown as `auto → {resolved}` so Discord/portal Top Models show what auto used.
 */
export function modelLimitCreditBreakdownSql(
  extraWhere: SQL,
  opts?: TokenMultiplierOpts & { limit?: number },
): SQL {
  const min = sql.raw(sqlMultiplierExpr("input", "raw_model", opts));
  const mout = sql.raw(sqlMultiplierExpr("output", "raw_model", opts));
  const lim =
    opts?.limit && opts.limit > 0 ? sql`LIMIT ${opts.limit}` : sql``;
  const displayModel = sql.raw(DISPLAY_MODEL_SQL_EXPR);

  if (tokenLimitWeightModeCache === "full") {
    return sql`
      SELECT
        model,
        COUNT(DISTINCT turn_key)::int as requests,
        COALESCE(SUM(inn * ${min}), 0) as "promptTokens",
        COALESCE(SUM(outt * ${mout}), 0) as "completionTokens",
        COALESCE(SUM(inn * ${min} + outt * ${mout}), 0) as tokens
      FROM (
        SELECT
          ${displayModel} as model,
          model as raw_model,
          COALESCE(turn_id, 'orphan-' || id::text) as turn_key,
          (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
          COALESCE(completion_tokens, 0)::float8 AS outt
        FROM request_logs
        WHERE ${extraWhere}
      ) hops
      GROUP BY model
      ORDER BY tokens DESC
      ${lim}
    `;
  }

  // peak / first_rest_flat / flat_all / custom — hop rn within turn
  const w = inputHopWeightSqlExpr();
  return sql`
    SELECT
      model,
      COUNT(DISTINCT turn_key)::int as requests,
      COALESCE(SUM(inn * (${sql.raw(w)}) * ${min}), 0) as "promptTokens",
      COALESCE(SUM(outt * ${mout}), 0) as "completionTokens",
      COALESCE(SUM(inn * (${sql.raw(w)}) * ${min} + outt * ${mout}), 0) as tokens
    FROM (
      SELECT
        ${displayModel} as model,
        model as raw_model,
        COALESCE(turn_id, 'orphan-' || id::text) as turn_key,
        (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
        COALESCE(completion_tokens, 0)::float8 AS outt,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(turn_id, 'orphan-' || id::text)
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM request_logs
      WHERE ${extraWhere}
    ) hops
    GROUP BY model
    ORDER BY tokens DESC
    ${lim}
  `;
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
    // Month boundaries must be derived from wibMidnight (WIB wall clock), not
    // from todayUtcMidnight — that one already has the offset applied, so
    // subtracting it again cut the first 7 hours of the month, and on days
    // where the UTC date lags WIB it even landed in the previous month.
    case "thisMonth": {
      const monthStartWib = new Date(wibMidnight);
      monthStartWib.setUTCDate(1);
      return { start: new Date(monthStartWib.getTime() - wibOffset), end: now };
    }
    case "lastMonth": {
      const monthStartWib = new Date(wibMidnight);
      monthStartWib.setUTCDate(1);
      const prevMonthWib = new Date(monthStartWib);
      prevMonthWib.setUTCMonth(prevMonthWib.getUTCMonth() - 1);
      return {
        start: new Date(prevMonthWib.getTime() - wibOffset),
        end: new Date(monthStartWib.getTime() - wibOffset),
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
