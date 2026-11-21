/**
 * Per-model history for the three surfaces (admin monitor, portal, Discord).
 *
 * One source, three renderers. Every surface must show the same numbers, so the
 * bucketing, the percentile maths and the range parsing live here and nowhere
 * else. Adding a range means adding it to RANGES — every caller derives its
 * selector from that list.
 *
 * Data source is `request_logs`: real user traffic. `model_monitor.latency_ms`
 * is a synthetic probe that reads 0 on every row and must never be shown as a
 * speed figure.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

/** Ranges the UI offers. `days: null` means "all time". */
export const RANGES = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "60d", label: "60 days", days: 60 },
  { key: "all", label: "All time", days: null },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export function parseRange(raw: unknown): { key: RangeKey; days: number | null } {
  const key = String(raw || "7d").toLowerCase();
  const hit = RANGES.find((r) => r.key === key);
  return hit ? { key: hit.key, days: hit.days } : { key: "7d", days: 7 };
}

/**
 * Bucket width per range. Wider ranges get coarser buckets so a chart never
 * has to draw thousands of points: 7d/30d are daily, 60d/all are weekly.
 */
function bucketFor(days: number | null): { sql: string; ms: number } {
  if (days != null && days <= 31) return { sql: "day", ms: 86_400_000 };
  return { sql: "week", ms: 7 * 86_400_000 };
}

export interface HistoryPoint {
  /** ISO date of the bucket start. */
  t: string;
  /** Requests in the bucket (all statuses). */
  req: number;
  ok: number;
  fail: number;
  /** p50 end-to-end latency in ms, 200s only. */
  p50: number | null;
  p95: number | null;
  /** Output tokens per second, 200s only. */
  tps: number | null;
  inTok: number;
  outTok: number;
  cachedTok: number;
}

export interface ModelHistory {
  model: string;
  range: RangeKey;
  days: number | null;
  bucket: "day" | "week";
  points: HistoryPoint[];
  totals: {
    req: number;
    ok: number;
    fail: number;
    successRate: number | null;
    p50: number | null;
    p95: number | null;
    tps: number | null;
    inTok: number;
    outTok: number;
    cachedTok: number;
    /** Distinct days with at least one successful request. */
    activeDays: number;
  };
  /** First and last request timestamps seen in the range. */
  firstSeen: string | null;
  lastSeen: string | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function optNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * History for one model. `model` must be the exact id used in request_logs.
 */
export async function getModelHistory(
  model: string,
  rangeRaw: unknown = "7d",
): Promise<ModelHistory> {
  const { key, days } = parseRange(rangeRaw);
  const bucket = bucketFor(days);
  const where = days == null
    ? sql`model = ${model}`
    : sql`model = ${model} AND created_at > NOW() - (${days} || ' days')::interval`;

  const rows = (await db.execute(sql`
    SELECT date_trunc(${bucket.sql}, created_at) AS bucket,
           COUNT(*)::int AS req,
           COUNT(CASE WHEN status_code = 200 THEN 1 END)::int AS ok,
           COUNT(CASE WHEN status_code <> 200 THEN 1 END)::int AS fail,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY CASE WHEN status_code = 200 THEN latency_ms END
           )::int AS p50,
           PERCENTILE_CONT(0.95) WITHIN GROUP (
             ORDER BY CASE WHEN status_code = 200 THEN latency_ms END
           )::int AS p95,
           SUM(CASE WHEN status_code = 200 THEN completion_tokens ELSE 0 END)::bigint AS out_tok,
           SUM(CASE WHEN status_code = 200 THEN latency_ms ELSE 0 END)::bigint AS ok_ms,
           SUM(prompt_tokens)::bigint AS in_tok,
           SUM(cached_tokens)::bigint AS cached_tok,
           MIN(created_at) AS first_seen,
           MAX(created_at) AS last_seen,
           COUNT(DISTINCT DATE(created_at))::int AS active_days
    FROM request_logs
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1
  `)).rows as any[];

  const points: HistoryPoint[] = rows.map((r) => {
    const outTok = num(r.out_tok);
    const okMs = num(r.ok_ms);
    return {
      t: r.bucket instanceof Date ? r.bucket.toISOString() : String(r.bucket),
      req: num(r.req),
      ok: num(r.ok),
      fail: num(r.fail),
      p50: optNum(r.p50),
      p95: optNum(r.p95),
      tps: okMs > 0 && outTok > 0 ? Math.round((outTok / (okMs / 1000)) * 10) / 10 : null,
      inTok: num(r.in_tok),
      outTok,
      cachedTok: num(r.cached_tok),
    };
  });

  // Totals are computed across the whole range, not by summing per-bucket
  // percentiles (averaging percentiles is wrong).
  const agg = (await db.execute(sql`
    SELECT COUNT(*)::int AS req,
           COUNT(CASE WHEN status_code = 200 THEN 1 END)::int AS ok,
           COUNT(CASE WHEN status_code <> 200 THEN 1 END)::int AS fail,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY CASE WHEN status_code = 200 THEN latency_ms END
           )::int AS p50,
           PERCENTILE_CONT(0.95) WITHIN GROUP (
             ORDER BY CASE WHEN status_code = 200 THEN latency_ms END
           )::int AS p95,
           SUM(CASE WHEN status_code = 200 THEN completion_tokens ELSE 0 END)::bigint AS out_tok,
           SUM(CASE WHEN status_code = 200 THEN latency_ms ELSE 0 END)::bigint AS ok_ms,
           SUM(prompt_tokens)::bigint AS in_tok,
           SUM(cached_tokens)::bigint AS cached_tok,
           MIN(created_at) AS first_seen,
           MAX(created_at) AS last_seen,
           COUNT(DISTINCT CASE WHEN status_code = 200 THEN DATE(created_at) END)::int AS active_days
    FROM request_logs
    WHERE ${where}
  `)).rows[0] as any;

  const req = num(agg?.req);
  const ok = num(agg?.ok);
  const outTok = num(agg?.out_tok);
  const okMs = num(agg?.ok_ms);

  return {
    model,
    range: key,
    days,
    bucket: bucket.sql as "day" | "week",
    points,
    totals: {
      req,
      ok,
      fail: num(agg?.fail),
      successRate: req > 0 ? Math.round((ok / req) * 10000) / 100 : null,
      p50: optNum(agg?.p50),
      p95: optNum(agg?.p95),
      tps: okMs > 0 && outTok > 0 ? Math.round((outTok / (okMs / 1000)) * 10) / 10 : null,
      inTok: num(agg?.in_tok),
      outTok,
      cachedTok: num(agg?.cached_tok),
      activeDays: num(agg?.active_days),
    },
    firstSeen: agg?.first_seen ? new Date(agg.first_seen).toISOString() : null,
    lastSeen: agg?.last_seen ? new Date(agg.last_seen).toISOString() : null,
  };
}

/**
 * Compact request counts for every model at once, used by list views that need
 * a "requests in the last N days" figure without N queries.
 */
export async function getRequestCountsByModel(
  rangeRaw: unknown = "7d",
): Promise<Map<string, { req: number; ok: number; fail: number }>> {
  const { days } = parseRange(rangeRaw);
  const where = days == null
    ? sql`TRUE`
    : sql`created_at > NOW() - (${days} || ' days')::interval`;

  const rows = (await db.execute(sql`
    SELECT model,
           COUNT(*)::int AS req,
           COUNT(CASE WHEN status_code = 200 THEN 1 END)::int AS ok,
           COUNT(CASE WHEN status_code <> 200 THEN 1 END)::int AS fail
    FROM request_logs
    WHERE ${where}
    GROUP BY model
  `)).rows as any[];

  const out = new Map<string, { req: number; ok: number; fail: number }>();
  for (const r of rows) {
    const key = String(r.model || "");
    if (!key) continue;
    out.set(key, { req: num(r.req), ok: num(r.ok), fail: num(r.fail) });
  }
  return out;
}
