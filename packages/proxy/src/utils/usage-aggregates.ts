import { and, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { requestLogs } from "../db/schema.js";
import {
  hopCountSql,
  turnCountSql,
  weightedHopInputTokensSql,
  weightedHopTotalTokensSql,
} from "./counting.js";
import {
  getTokenLimitWeightModeSync,
  getTokenLimitWeightPercentSync,
} from "./counting.js";
import { resolveAccountTokenTier } from "./account-token-tier.js";

export const USAGE_BREAKDOWN_PERIODS = ["1d", "3d", "7d", "30d"] as const;
export type UsageBreakdownPeriod = (typeof USAGE_BREAKDOWN_PERIODS)[number];
export type UsageBreakdownDimension = "ide" | "model";

export interface UsageBreakdownTotals {
  turns: number;
  apiCalls: number;
  hops: number;
  success: number;
  fail: number;
  rawBillableInput: number;
  cachedInput: number;
  output: number;
  total: number;
  inputTowardLimit: number;
  outputTowardLimit: number;
  amountTowardLimit: number;
}

export interface UsageMeterComposition {
  creditHops: number;
  localHops: number;
  upstreamInputBeforeWeight: number;
  upstreamOutputBeforeWeight: number;
  localInputBeforeWeight: number;
  localOutputBeforeWeight: number;
  inputHopWeightMode: string;
  followUpInputWeightPercent: number;
}

export interface UsageBreakdownGroup extends UsageBreakdownTotals {
  name: string;
}

export interface AccountUsageBreakdown {
  period: UsageBreakdownPeriod;
  from: string;
  to: string;
  timezone: "Asia/Jakarta";
  totals: UsageBreakdownTotals;
  towardLimit: {
    input: number;
    output: number;
    total: number;
    source: "canonical-limit-meter";
    explanation: string;
  };
  byIde: UsageBreakdownGroup[];
  byModel: UsageBreakdownGroup[];
}

const DAY_MS = 86_400_000;

export function parseUsageBreakdownPeriod(value: string | undefined): UsageBreakdownPeriod {
  const period = value || "1d";
  if ((USAGE_BREAKDOWN_PERIODS as readonly string[]).includes(period)) {
    return period as UsageBreakdownPeriod;
  }
  throw new Error(`Invalid period "${period}". Expected one of: ${USAGE_BREAKDOWN_PERIODS.join(", ")}`);
}

/** Rolling range, unlike the calendar-day ranges used by dashboard charts. */
export function resolveUsageBreakdownRange(
  period: UsageBreakdownPeriod,
  now = new Date(),
): { from: Date; to: Date } {
  const days = Number.parseInt(period, 10);
  return { from: new Date(now.getTime() - days * DAY_MS), to: now };
}

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountWhere(discordUserId: string, from: Date, to: Date): SQL {
  return and(
    sql`api_key_id IN (SELECT id FROM api_keys WHERE discord_user_id = ${discordUserId})`,
    sql`created_at >= ${from}`,
    sql`created_at <= ${to}`,
  )!;
}

async function aggregate(where: SQL, isTrial: boolean): Promise<UsageBreakdownTotals> {
  const successful = and(where, sql`status_code BETWEEN 200 AND 299`)!;
  const successfulTurns = and(successful, sql`turn_id IS NOT NULL`)!;
  const [row] = await db.select({
    turns: turnCountSql(successfulTurns),
    apiCalls: hopCountSql(where),
    success: hopCountSql(successful),
    fail: hopCountSql(and(where, sql`NOT (status_code BETWEEN 200 AND 299)`) as SQL),
    rawBillableInput: sql<number>`COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN COALESCE(prompt_tokens, 0) ELSE 0 END), 0)`,
    cachedInput: sql<number>`COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN COALESCE(cached_tokens, 0) ELSE 0 END), 0)`,
    output: sql<number>`COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN COALESCE(completion_tokens, 0) ELSE 0 END), 0)`,
    inputTowardLimit: weightedHopInputTokensSql(successful, { isTrial }),
    amountTowardLimit: weightedHopTotalTokensSql(successful, { isTrial }),
  }).from(sql`request_logs`).where(where);

  const rawBillableInput = n(row?.rawBillableInput);
  const cachedInput = n(row?.cachedInput);
  const output = n(row?.output);
  const inputTowardLimit = n(row?.inputTowardLimit);
  const amountTowardLimit = n(row?.amountTowardLimit);
  return {
    turns: n(row?.turns),
    apiCalls: n(row?.apiCalls),
    hops: n(row?.apiCalls),
    success: n(row?.success),
    fail: n(row?.fail),
    rawBillableInput,
    cachedInput,
    output,
    total: rawBillableInput + cachedInput + output,
    inputTowardLimit,
    outputTowardLimit: Math.max(0, amountTowardLimit - inputTowardLimit),
    amountTowardLimit,
  };
}

async function meterComposition(
  where: SQL,
  isTrial: boolean,
): Promise<UsageMeterComposition> {
  const successful = and(where, sql`status_code BETWEEN 200 AND 299`)!;
  const { sqlMultiplierExpr } = await import("./token-multiplier.js");
  const inputMultiplier = sql.raw(sqlMultiplierExpr("input", "model", { isTrial }));
  const outputMultiplier = sql.raw(sqlMultiplierExpr("output", "model", { isTrial }));
  const [row] = await db.select({
    creditHops: sql<number>`COUNT(*) FILTER (WHERE COALESCE(upstream_credits, 0) > 0)`,
    localHops: sql<number>`COUNT(*) FILTER (WHERE COALESCE(upstream_credits, 0) <= 0)`,
    upstreamInputBeforeWeight: sql<number>`COALESCE(SUM(
      CASE WHEN COALESCE(upstream_credits, 0) > 0
        THEN GREATEST(0, COALESCE(upstream_credits, 0) - COALESCE(upstream_credits_out, 0))
        ELSE 0 END
    ), 0)`,
    upstreamOutputBeforeWeight: sql<number>`COALESCE(SUM(
      CASE WHEN COALESCE(upstream_credits, 0) > 0
        THEN COALESCE(upstream_credits_out, 0)
        ELSE 0 END
    ), 0)`,
    localInputBeforeWeight: sql<number>`COALESCE(SUM(
      CASE WHEN COALESCE(upstream_credits, 0) <= 0
        THEN (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) * ${inputMultiplier}
        ELSE 0 END
    ), 0)`,
    localOutputBeforeWeight: sql<number>`COALESCE(SUM(
      CASE WHEN COALESCE(upstream_credits, 0) <= 0
        THEN COALESCE(completion_tokens, 0) * ${outputMultiplier}
        ELSE 0 END
    ), 0)`,
  }).from(requestLogs).where(successful);
  return {
    creditHops: n(row?.creditHops),
    localHops: n(row?.localHops),
    upstreamInputBeforeWeight: n(row?.upstreamInputBeforeWeight),
    upstreamOutputBeforeWeight: n(row?.upstreamOutputBeforeWeight),
    localInputBeforeWeight: n(row?.localInputBeforeWeight),
    localOutputBeforeWeight: n(row?.localOutputBeforeWeight),
    inputHopWeightMode: getTokenLimitWeightModeSync(),
    followUpInputWeightPercent: getTokenLimitWeightPercentSync(),
  };
}

async function aggregateBy(
  dimension: UsageBreakdownDimension,
  where: SQL,
  isTrial: boolean,
): Promise<UsageBreakdownGroup[]> {
  const column = dimension === "ide" ? sql`ide_detected` : sql`model`;
  const rows = (await db.execute(sql`
    SELECT DISTINCT COALESCE(NULLIF(${column}, ''), 'unknown') AS name
    FROM request_logs WHERE ${where}
  `)).rows as Array<{ name: string }>;

  const result = await Promise.all(rows.map(async ({ name }) => ({
    name,
    ...await aggregate(
      and(where, sql`COALESCE(NULLIF(${column}, ''), 'unknown') = ${name}`)!,
      isTrial,
    ),
  })));
  return result.sort((a, b) => b.amountTowardLimit - a.amountTowardLimit || b.apiCalls - a.apiCalls);
}

export async function getAccountUsageBreakdown(
  discordUserId: string,
  period: UsageBreakdownPeriod,
  now = new Date(),
): Promise<AccountUsageBreakdown> {
  const { from, to } = resolveUsageBreakdownRange(period, now);
  const where = accountWhere(discordUserId, from, to);
  const tier = await resolveAccountTokenTier(discordUserId);
  const isTrial = tier.isTrial;
  const [totals, composition, byIde, byModel] = await Promise.all([
    aggregate(where, isTrial),
    meterComposition(where, isTrial),
    aggregateBy("ide", where, isTrial),
    aggregateBy("model", where, isTrial),
  ]);
  const mode = getTokenLimitWeightModeSync();
  const percent = getTokenLimitWeightPercentSync();

  const compatibility = <T extends UsageBreakdownTotals>(row: T) => ({
    ...row,
    successfulHops: row.success,
    failedHops: row.fail,
    billableInputTokens: row.rawBillableInput,
    cachedInputTokens: row.cachedInput,
    outputTokens: row.output,
    rawTotalTokens: row.total,
    upstreamInputCredits: row.inputTowardLimit,
    upstreamOutputCredits: row.outputTowardLimit,
  });
  const explanation = `Canonical gate meter: upstream credits when present; otherwise configured model multipliers and ${mode} hop weighting (${percent}%). Output is weighted by the canonical output meter.`;
  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: "Asia/Jakarta",
    totals: compatibility(totals),
    towardLimit: {
      input: totals.inputTowardLimit,
      output: totals.outputTowardLimit,
      total: totals.amountTowardLimit,
      source: "canonical-limit-meter",
      explanation,
    },
    composition,
    meter: {
      source: "canonical-limit-meter",
      explanation,
    },
    byIde: byIde.map(compatibility),
    byModel: byModel.map(compatibility),
  };
}
