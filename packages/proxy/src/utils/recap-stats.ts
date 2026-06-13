/**
 * Monthly Recap statistics.
 *
 * PRIVACY GUARD: This module MUST only read aggregate numeric / category columns.
 * It DELIBERATELY never selects: request_preview, response_preview,
 * transcript_snapshot, error_message, user_message_hash, tools_used (detail),
 * session_name, or any column revealing WHAT the user worked on.
 * Only counts, tokens, timing, model names, IDE names, day/hour buckets, ranks.
 */

import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { getTokenMultipliers } from "./token-multiplier.js";
import { getMonthRangeUtc } from "./recap-window.js";
import { getModelRates } from "./cost-calculator.js";

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface ModelStat {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
}

export interface DayStat {
  day: string; // YYYY-MM-DD (WIB)
  requests: number;
  tokens: number;
}

export interface HourStat {
  hour: number; // 0..23 WIB
  requests: number;
  outputTokens: number;
}

export interface IdeStat {
  ide: string;
  requests: number;
}

export interface RecapStats {
  yearMonth: string;
  hasData: boolean;
  source: "live" | "archived";
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number; // micro-dollars
    avgTokensPerRequest: number;
    ioRatio: number; // output / max(input,1)
  };
  models: {
    favorite: string | null;
    top: ModelStat[];
    leastUsed: ModelStat[];
    uniqueCount: number;
    fastest: ModelStat | null;
    slowest: ModelStat | null;
  };
  activity: {
    mostActiveDay: DayStat | null;
    quietestActiveDay: DayStat | null;
    mostActiveHour: HourStat | null;
    mostProductiveHour: HourStat | null;
    activeDays: number;
    inactiveDays: number;
    longestStreak: number;
    firstActiveDay: string | null;
    lastActiveDay: string | null;
    favoriteWeekday: string | null;
    weekendRequests: number;
    weekdayRequests: number;
    perDay: DayStat[];
    perHour: HourStat[];
  };
  sessions: {
    count: number;
    avgRequestsPerSession: number;
    longestSessionRequests: number;
  };
  ide: {
    favorite: string | null;
    uniqueCount: number;
    top: IdeStat[];
    leastUsed: IdeStat | null;
  };
  devices: {
    uniqueCount: number;
  };
  tools: {
    totalToolCalls: number;
    toolTurnPercent: number;
  };
  latency: {
    avgMs: number;
    fastestMs: number;
    slowestMs: number;
  };
  cost: {
    totalMicro: number; // micro-dollars total
    inputMicro: number;
    outputMicro: number;
    mostExpensiveModel: { model: string; micro: number } | null;
    cheapestModel: { model: string; micro: number } | null;
    mostExpensiveDay: { day: string; micro: number } | null;
    mostExpensiveHour: { hour: number; micro: number } | null;
  };
  errors: {
    errorPercent: number; // % of requests with non-2xx status
  };
  rank: {
    requests: number; // 0 = unranked
    tokens: number;
    totalParticipants: number;
  };
  comparison: {
    hasPrev: boolean;
    requestsDeltaPercent: number;
    tokensDeltaPercent: number;
  };
  population?: {
    participants: number;
    medianRatio: number;
    ratioP25: number;
    ratioP75: number;
    requestsP75: number;
    requestsP90: number;
    tokensP75: number;
    tokensP90: number;
  };
  race?: {
    days: string[];
    byRequests: { users: Array<{ name: string | null; avatar: string | null; rank: number; isMe: boolean; cumulative: number[] }>; myRank: number; baseRank: number; totalParticipants: number } | null;
    byTokens: { users: Array<{ name: string | null; avatar: string | null; rank: number; isMe: boolean; cumulative: number[] }>; myRank: number; baseRank: number; totalParticipants: number } | null;
  } | null;
}

const WEEKDAY_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const VALID = sql`status_code BETWEEN 200 AND 299`;

/** Compute longest consecutive-day streak from a sorted set of YYYY-MM-DD strings. */
function longestStreak(days: string[]): number {
  if (days.length === 0) return 0;
  const sorted = [...new Set(days)].sort();
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00Z").getTime();
    const now = new Date(sorted[i] + "T00:00:00Z").getTime();
    if (now - prev === 86400000) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

/**
 * Per-turn aggregated totals for one api key in a month (multiplier-aware).
 * Mirrors counting.ts turn-based logic but inlined to also extract latency/tools.
 */
async function fetchTotals(keyId: number, start: Date, end: Date) {
  const { input, output } = getTokenMultipliers();
  const row = (await db.execute(sql`
    SELECT
      COUNT(*) AS turns,
      COALESCE(SUM(sum_delta), 0) AS input_raw,
      COALESCE(SUM(sum_c), 0) AS output_raw,
      COALESCE(SUM(est), 0) AS est_cost
    FROM (
      SELECT turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) AS sum_delta,
        SUM(completion_tokens) AS sum_c,
        SUM(estimated_cost) AS est
      FROM request_logs
      WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY turn_id
    ) t
  `)).rows[0] as any;

  const requests = num(row?.turns);
  const inputTokens = Math.round(num(row?.input_raw) * input);
  const outputTokens = Math.round(num(row?.output_raw) * output);
  const totalTokens = inputTokens + outputTokens;
  return {
    requests,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost: Math.round(num(row?.est_cost)),
    avgTokensPerRequest: requests > 0 ? Math.round(totalTokens / requests) : 0,
    ioRatio: outputTokens / Math.max(inputTokens, 1),
  };
}

/** Per-model breakdown with latency (auto normalized to base model). */
async function fetchModels(keyId: number, start: Date, end: Date): Promise<ModelStat[]> {
  const { input, output } = getTokenMultipliers();
  const rows = (await db.execute(sql`
    SELECT model,
      COUNT(DISTINCT turn_id) AS requests,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END), 0) AS input_raw,
      COALESCE(SUM(completion_tokens), 0) AS output_raw,
      COALESCE(AVG(NULLIF(latency_ms, 0)), 0) AS avg_lat
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END AS model,
        turn_id, context_delta_tokens, completion_tokens, latency_ms
      FROM request_logs
      WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    ) m
    GROUP BY model
    ORDER BY requests DESC
  `)).rows as any[];

  return rows.map((r) => ({
    model: r.model || "unknown",
    requests: num(r.requests),
    inputTokens: Math.round(num(r.input_raw) * input),
    outputTokens: Math.round(num(r.output_raw) * output),
    avgLatencyMs: Math.round(num(r.avg_lat)),
  }));
}

/** Per-day and per-hour estimated_cost (micro-dollars) buckets (WIB). */
async function fetchCostBuckets(keyId: number, start: Date, end: Date): Promise<{ day: { day: string; micro: number } | null; hour: { hour: number; micro: number } | null }> {
  const dayRows = (await db.execute(sql`
    SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
      COALESCE(SUM(estimated_cost), 0) AS micro
    FROM request_logs
    WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
      AND status_code BETWEEN 200 AND 299
    GROUP BY day ORDER BY micro DESC LIMIT 1
  `)).rows as any[];
  const hourRows = (await db.execute(sql`
    SELECT CAST(to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'HH24') AS INTEGER) AS hour,
      COALESCE(SUM(estimated_cost), 0) AS micro
    FROM request_logs
    WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
      AND status_code BETWEEN 200 AND 299
    GROUP BY hour ORDER BY micro DESC LIMIT 1
  `)).rows as any[];
  const d = dayRows[0];
  const h = hourRows[0];
  return {
    day: d && num(d.micro) > 0 ? { day: d.day, micro: Math.round(num(d.micro)) } : null,
    hour: h && num(h.micro) > 0 ? { hour: num(h.hour), micro: Math.round(num(h.micro)) } : null,
  };
}

/** Build the cost breakdown from per-model token splits + rates + cost buckets. */
function buildCost(models: ModelStat[], buckets: { day: any; hour: any }): RecapStats["cost"] {
  let inputMicro = 0, outputMicro = 0;
  const perModel: Array<{ model: string; micro: number }> = [];
  for (const m of models) {
    const rates = getModelRates(m.model || "");
    // rates are $ per token (micro = tokens * rate). cost-calculator returns
    // $/token-scaled values used as (tokens * rate) -> micro-dollars.
    const inMicro = Math.round(m.inputTokens * rates.prompt);
    const outMicro = Math.round(m.outputTokens * rates.completion);
    inputMicro += inMicro;
    outputMicro += outMicro;
    perModel.push({ model: m.model, micro: inMicro + outMicro });
  }
  const used = perModel.filter((p) => p.micro > 0);
  const sorted = [...used].sort((a, b) => b.micro - a.micro);
  return {
    totalMicro: inputMicro + outputMicro,
    inputMicro,
    outputMicro,
    mostExpensiveModel: sorted.length ? sorted[0] : null,
    cheapestModel: sorted.length ? sorted[sorted.length - 1] : null,
    mostExpensiveDay: buckets.day,
    mostExpensiveHour: buckets.hour,
  };
}

/** Per-day (WIB) request + token buckets. */
async function fetchPerDay(keyId: number, start: Date, end: Date): Promise<DayStat[]> {
  const { input, output } = getTokenMultipliers();
  const rows = (await db.execute(sql`
    SELECT day,
      COUNT(DISTINCT turn_id) AS requests,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END), 0) AS input_raw,
      COALESCE(SUM(completion_tokens), 0) AS output_raw
    FROM (
      SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
        turn_id, context_delta_tokens, completion_tokens
      FROM request_logs
      WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    ) d
    GROUP BY day
    ORDER BY day
  `)).rows as any[];

  return rows.map((r) => ({
    day: r.day,
    requests: num(r.requests),
    tokens: Math.round(num(r.input_raw) * input + num(r.output_raw) * output),
  }));
}

/** Per-hour-of-day (WIB) request + output token buckets. */
async function fetchPerHour(keyId: number, start: Date, end: Date): Promise<HourStat[]> {
  const { output } = getTokenMultipliers();
  const rows = (await db.execute(sql`
    SELECT hour,
      COUNT(DISTINCT turn_id) AS requests,
      COALESCE(SUM(completion_tokens), 0) AS output_raw
    FROM (
      SELECT CAST(to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'HH24') AS INTEGER) AS hour,
        turn_id, completion_tokens
      FROM request_logs
      WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    ) h
    GROUP BY hour
    ORDER BY hour
  `)).rows as any[];

  return rows.map((r) => ({
    hour: num(r.hour),
    requests: num(r.requests),
    outputTokens: Math.round(num(r.output_raw) * output),
  }));
}

/** Aux per-request stats: sessions, ide, devices, tools, latency, errors, weekday split. */
async function fetchAux(keyId: number, start: Date, end: Date) {
  const sessionRow = (await db.execute(sql`
    SELECT COUNT(*) AS cnt, COALESCE(MAX(request_count), 0) AS longest, COALESCE(SUM(request_count), 0) AS total_req
    FROM chat_sessions
    WHERE api_key_id = ${keyId} AND first_seen_at >= ${start} AND first_seen_at < ${end}
  `)).rows[0] as any;

  const ideRows = (await db.execute(sql`
    SELECT COALESCE(NULLIF(ide_detected, ''), 'unknown') AS ide, COUNT(DISTINCT turn_id) AS requests
    FROM request_logs
    WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
      AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    GROUP BY COALESCE(NULLIF(ide_detected, ''), 'unknown')
    ORDER BY requests DESC
  `)).rows as any[];

  const deviceRow = (await db.execute(sql`
    SELECT COUNT(DISTINCT device_fingerprint) AS cnt
    FROM request_logs
    WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
      AND status_code BETWEEN 200 AND 299 AND device_fingerprint IS NOT NULL
  `)).rows[0] as any;

  const toolRow = (await db.execute(sql`
    SELECT
      COALESCE(SUM(tool_count), 0) AS tool_calls,
      COUNT(DISTINCT turn_id) AS total_turns,
      COUNT(DISTINCT CASE WHEN has_tool_calls = true THEN turn_id END) AS tool_turns
    FROM request_logs
    WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
      AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
  `)).rows[0] as any;

  const latRow = (await db.execute(sql`
    SELECT COALESCE(AVG(NULLIF(latency_ms,0)),0) AS avg_ms,
      COALESCE(MIN(NULLIF(latency_ms,0)),0) AS min_ms,
      COALESCE(MAX(latency_ms),0) AS max_ms
    FROM request_logs
    WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
      AND status_code BETWEEN 200 AND 299
  `)).rows[0] as any;

  const errRow = (await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN status_code < 200 OR status_code > 299 THEN 1 END) AS errors
    FROM request_logs
    WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
  `)).rows[0] as any;

  const weekdayRows = (await db.execute(sql`
    SELECT dow, COUNT(DISTINCT turn_id) AS requests
    FROM (
      SELECT CAST(to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'D') AS INTEGER) AS dow, turn_id
      FROM request_logs
      WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    ) w
    GROUP BY dow
  `)).rows as any[];

  const totalTurns = num(toolRow?.total_turns);
  const toolTurns = num(toolRow?.tool_turns);
  const totalReq = num(errRow?.total);
  const errors = num(errRow?.errors);

  // postgres 'D' is 1=Sunday..7=Saturday
  let weekend = 0, weekday = 0;
  let favWeekdayIdx = -1, favWeekdayVal = -1;
  for (const r of weekdayRows) {
    const dow = num(r.dow); // 1..7
    const reqs = num(r.requests);
    const idx0 = dow - 1; // 0=Sunday
    if (idx0 === 0 || idx0 === 6) weekend += reqs; else weekday += reqs;
    if (reqs > favWeekdayVal) { favWeekdayVal = reqs; favWeekdayIdx = idx0; }
  }

  return {
    sessions: {
      count: num(sessionRow?.cnt),
      avgRequestsPerSession: num(sessionRow?.cnt) > 0 ? Math.round(num(sessionRow?.total_req) / num(sessionRow?.cnt)) : 0,
      longestSessionRequests: num(sessionRow?.longest),
    },
    ide: ideRows.map((r) => ({ ide: r.ide, requests: num(r.requests) })),
    deviceCount: num(deviceRow?.cnt),
    tools: {
      totalToolCalls: num(toolRow?.tool_calls),
      toolTurnPercent: totalTurns > 0 ? Math.round((toolTurns / totalTurns) * 100) : 0,
    },
    latency: {
      avgMs: Math.round(num(latRow?.avg_ms)),
      fastestMs: Math.round(num(latRow?.min_ms)),
      slowestMs: Math.round(num(latRow?.max_ms)),
    },
    errors: { errorPercent: totalReq > 0 ? Math.round((errors / totalReq) * 100) : 0 },
    weekend,
    weekday,
    favoriteWeekday: favWeekdayIdx >= 0 ? WEEKDAY_ID[favWeekdayIdx] : null,
  };
}

/** Derive activity insights (most active day/hour, streaks, etc.) from per-day/hour. */
function deriveActivity(perDay: DayStat[], perHour: HourStat[], aux: Awaited<ReturnType<typeof fetchAux>>, start: Date, end: Date) {
  const mostActiveDay = perDay.length ? [...perDay].sort((a, b) => b.requests - a.requests)[0] : null;
  const quietestActiveDay = perDay.length ? [...perDay].sort((a, b) => a.requests - b.requests)[0] : null;
  const mostActiveHour = perHour.length ? [...perHour].sort((a, b) => b.requests - a.requests)[0] : null;
  const mostProductiveHour = perHour.length ? [...perHour].sort((a, b) => b.outputTokens - a.outputTokens)[0] : null;
  const activeDays = perDay.filter((d) => d.requests > 0).length;
  const totalDaysInMonth = Math.round((end.getTime() - start.getTime()) / 86400000);
  return {
    mostActiveDay,
    quietestActiveDay,
    mostActiveHour,
    mostProductiveHour,
    activeDays,
    inactiveDays: Math.max(0, totalDaysInMonth - activeDays),
    longestStreak: longestStreak(perDay.map((d) => d.day)),
    firstActiveDay: perDay.length ? perDay[0].day : null,
    lastActiveDay: perDay.length ? perDay[perDay.length - 1].day : null,
    favoriteWeekday: aux.favoriteWeekday,
    weekendRequests: aux.weekend,
    weekdayRequests: aux.weekday,
    perDay,
    perHour,
  };
}

/**
 * Build the complete recap stats object for one api key + target month.
 * Aggregate-only; no conversation content read.
 */
export async function getRecapStats(keyId: number, yearMonth: string): Promise<RecapStats> {
  const { start, end } = getMonthRangeUtc(yearMonth);

  const [totals, models, perDay, perHour, aux, costBuckets] = await Promise.all([
    fetchTotals(keyId, start, end),
    fetchModels(keyId, start, end),
    fetchPerDay(keyId, start, end),
    fetchPerHour(keyId, start, end),
    fetchAux(keyId, start, end),
    fetchCostBuckets(keyId, start, end),
  ]);

  const hasData = totals.requests > 0;

  const withLatency = models.filter((m) => m.avgLatencyMs > 0);
  const fastest = withLatency.length ? [...withLatency].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0] : null;
  const slowest = withLatency.length ? [...withLatency].sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)[0] : null;
  const leastUsed = models.length > 1 ? [...models].sort((a, b) => a.requests - b.requests).slice(0, 3) : [];

  const activity = deriveActivity(perDay, perHour, aux, start, end);

  const ideTop = aux.ide.filter((i) => i.ide !== "unknown");
  const ideSorted = [...ideTop].sort((a, b) => b.requests - a.requests);

  return {
    yearMonth,
    hasData,
    source: "live",
    totals,
    models: {
      favorite: models.length ? models[0].model : null,
      top: models.slice(0, 5),
      leastUsed,
      uniqueCount: models.length,
      fastest,
      slowest,
    },
    activity,
    sessions: aux.sessions,
    ide: {
      favorite: ideSorted.length ? ideSorted[0].ide : null,
      uniqueCount: ideSorted.length,
      top: ideSorted.slice(0, 5),
      leastUsed: ideSorted.length > 1 ? ideSorted[ideSorted.length - 1] : null,
    },
    devices: { uniqueCount: aux.deviceCount },
    tools: aux.tools,
    latency: aux.latency,
    cost: buildCost(models, costBuckets),
    errors: aux.errors,
    rank: { requests: 0, tokens: 0, totalParticipants: 0 },
    comparison: { hasPrev: false, requestsDeltaPercent: 0, tokensDeltaPercent: 0 },
  };
}

export interface LeaderboardEntry {
  apiKeyId: number | null;
  discordUserId: string | null;
  discordUsername: string | null;
  apiKeyName: string | null;
  requests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Compute the global per-key leaderboard for a month (multiplier-aware),
 * ordered separately by requests and tokens. Returns full ranked lists.
 */
export async function getMonthLeaderboard(yearMonth: string): Promise<{
  byRequests: LeaderboardEntry[];
  byTokens: LeaderboardEntry[];
}> {
  const { start, end } = getMonthRangeUtc(yearMonth);
  const { input, output } = getTokenMultipliers();

  const rows = (await db.execute(sql`
    SELECT t.api_key_id AS api_key_id,
      k.discord_user_id AS discord_user_id,
      k.discord_username AS discord_username,
      k.name AS api_key_name,
      COALESCE(SUM(t.turn_present), 0) AS requests,
      COALESCE(SUM(t.sum_delta) * ${input} + SUM(t.sum_c) * ${output}, 0) AS tokens,
      COALESCE(SUM(t.sum_delta) * ${input}, 0) AS input_tokens,
      COALESCE(SUM(t.sum_c) * ${output}, 0) AS output_tokens
    FROM (
      SELECT api_key_id, turn_id,
        1 AS turn_present,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) AS sum_delta,
        SUM(completion_tokens) AS sum_c
      FROM request_logs
      WHERE created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL AND api_key_id IS NOT NULL
      GROUP BY api_key_id, turn_id
    ) t
    LEFT JOIN api_keys k ON k.id = t.api_key_id
    GROUP BY t.api_key_id, k.discord_user_id, k.discord_username, k.name
  `)).rows as any[];

  const entries: LeaderboardEntry[] = rows.map((r) => ({
    apiKeyId: num(r.api_key_id) || null,
    discordUserId: r.discord_user_id || null,
    discordUsername: r.discord_username || null,
    apiKeyName: r.api_key_name || null,
    requests: num(r.requests),
    tokens: Math.round(num(r.tokens)),
    inputTokens: Math.round(num(r.input_tokens)),
    outputTokens: Math.round(num(r.output_tokens)),
  }));

  const byRequests = [...entries].sort((a, b) => b.requests - a.requests);
  const byTokens = [...entries].sort((a, b) => b.tokens - a.tokens);
  return { byRequests, byTokens };
}

/** Find a key's 1-based rank in a sorted list (0 if not present / no usage). */
export function findRank(list: LeaderboardEntry[], keyId: number): number {
  const idx = list.findIndex((e) => e.apiKeyId === keyId && (e.requests > 0 || e.tokens > 0));
  return idx >= 0 ? idx + 1 : 0;
}

export interface TimelapseUser {
  name: string | null;
  avatar: string | null;
  rank: number; // final rank within the window's global ranking
  isMe: boolean;
  cumulative: number[]; // cumulative requests aligned to days[]
}

export interface TimelapseTrack {
  users: TimelapseUser[]; // windowed around the user's rank for this metric
  myRank: number;
  baseRank: number; // global rank of the top user in this window (for per-day labels)
  totalParticipants: number;
}

export interface RaceTimelapse {
  days: string[]; // YYYY-MM-DD (WIB), day 1 .. today
  byRequests: TimelapseTrack | null;
  byTokens: TimelapseTrack | null;
}

/** Per-day cumulative request counts for a single key across the month (WIB). */
async function fetchPerDayRequests(keyId: number, start: Date, end: Date): Promise<Map<string, number>> {
  const rows = (await db.execute(sql`
    SELECT day, COUNT(DISTINCT turn_id) AS requests
    FROM (
      SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day, turn_id
      FROM request_logs
      WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    ) d GROUP BY day
  `)).rows as any[];
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.day, num(r.requests));
  return m;
}

/** Per-day total token counts (multiplier-aware) for one key (WIB). */
async function fetchPerDayTokens(keyId: number, start: Date, end: Date): Promise<Map<string, number>> {
  const { input, output } = getTokenMultipliers();
  const rows = (await db.execute(sql`
    SELECT day,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) * ${input}
        + SUM(completion_tokens) * ${output}, 0) AS tokens
    FROM (
      SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
        context_delta_tokens, completion_tokens
      FROM request_logs
      WHERE api_key_id = ${keyId} AND created_at >= ${start} AND created_at < ${end}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    ) d GROUP BY day
  `)).rows as any[];
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.day, Math.round(num(r.tokens)));
  return m;
}

/**
 * Build the leaderboard timelapse: a window of users around the viewer's final
 * rank, each with cumulative request counts per day (day 1 .. today). Used for
 * the bar-chart-race on the web. Counts only (privacy-safe).
 */
export async function getRaceTimelapse(
  keyId: number,
  yearMonth: string,
  leaderboard: { byRequests: LeaderboardEntry[]; byTokens: LeaderboardEntry[] },
): Promise<RaceTimelapse | null> {
  const { start, end } = getMonthRangeUtc(yearMonth);

  // Shared day axis: day 1 of month .. min(today, month end), WIB.
  const WIB = 7 * 60 * 60 * 1000;
  const todayWib = new Date(Date.now() + WIB);
  const days: string[] = [];
  const cursor = new Date(start.getTime() + WIB);
  while (cursor < end) {
    const ds = cursor.toISOString().slice(0, 10);
    days.push(ds);
    if (ds === todayWib.toISOString().slice(0, 10)) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (days.length >= 31) break;
  }
  if (days.length === 0) return null;

  // Build one windowed metric track (requests or tokens).
  const buildTrack = async (
    list: LeaderboardEntry[],
    metric: "requests" | "tokens",
  ): Promise<TimelapseTrack | null> => {
    const active = list.filter((e) => (metric === "requests" ? e.requests > 0 : e.tokens > 0) && e.apiKeyId != null);
    if (active.length < 2) return null;
    const myIdx = active.findIndex((e) => e.apiKeyId === keyId);
    if (myIdx < 0) return null;
    const lo = Math.max(0, myIdx - 5);
    const hi = Math.min(active.length, myIdx + 6);
    const windowed = active.slice(lo, hi);

    const users: TimelapseUser[] = [];
    for (const e of windowed) {
      const perDay = metric === "requests"
        ? await fetchPerDayRequests(e.apiKeyId!, start, end)
        : await fetchPerDayTokens(e.apiKeyId!, start, end);
      const cumulative: number[] = [];
      let c = 0;
      for (const d of days) { c += perDay.get(d) || 0; cumulative.push(c); }
      users.push({
        name: e.discordUsername || null,
        avatar: null,
        rank: active.indexOf(e) + 1,
        isMe: e.apiKeyId === keyId,
        cumulative,
      });
    }
    return { users, myRank: myIdx + 1, baseRank: lo + 1, totalParticipants: active.length };
  };

  const byRequests = await buildTrack(leaderboard.byRequests, "requests");
  const byTokens = await buildTrack(leaderboard.byTokens, "tokens");
  if (!byRequests && !byTokens) return null;

  return { days, byRequests, byTokens };
}

/** Percentile (0..1) of a numeric array (linear interpolation). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface PopulationContext {
  participants: number;
  medianRatio: number;
  ratioP25: number;
  ratioP75: number;
  requestsP75: number;
  requestsP90: number;
  tokensP75: number;
  tokensP90: number;
}

/** Derive population percentiles from a month leaderboard (active users only). */
export function computePopulation(leaderboard: { byRequests: LeaderboardEntry[] }): PopulationContext {
  const active = leaderboard.byRequests.filter((e) => e.requests > 0);
  const ratios = active.map((e) => e.outputTokens / Math.max(e.inputTokens, 1)).sort((a, b) => a - b);
  const reqs = active.map((e) => e.requests).sort((a, b) => a - b);
  const toks = active.map((e) => e.tokens).sort((a, b) => a - b);
  return {
    participants: active.length,
    medianRatio: percentile(ratios, 0.5),
    ratioP25: percentile(ratios, 0.25),
    ratioP75: percentile(ratios, 0.75),
    requestsP75: percentile(reqs, 0.75),
    requestsP90: percentile(reqs, 0.90),
    tokensP75: percentile(toks, 0.75),
    tokensP90: percentile(toks, 0.90),
  };
}

/** Attach rank + previous-month comparison to a stats object (mutates + returns). */
export async function enrichRankAndComparison(
  stats: RecapStats,
  keyId: number,
  leaderboard: { byRequests: LeaderboardEntry[]; byTokens: LeaderboardEntry[] },
  prevYearMonth: string,
): Promise<RecapStats> {
  stats.rank.requests = findRank(leaderboard.byRequests, keyId);
  stats.rank.tokens = findRank(leaderboard.byTokens, keyId);
  stats.rank.totalParticipants = leaderboard.byRequests.filter((e) => e.requests > 0).length;
  stats.population = computePopulation(leaderboard);

  try {
    const prev = await fetchTotals(keyId, getMonthRangeUtc(prevYearMonth).start, getMonthRangeUtc(prevYearMonth).end);
    if (prev.requests > 0) {
      stats.comparison.hasPrev = true;
      stats.comparison.requestsDeltaPercent = Math.round(((stats.totals.requests - prev.requests) / prev.requests) * 100);
      stats.comparison.tokensDeltaPercent = prev.totalTokens > 0
        ? Math.round(((stats.totals.totalTokens - prev.totalTokens) / prev.totalTokens) * 100)
        : 0;
    }
  } catch {
    // prev month may be archived/cleaned; skip comparison
  }
  return stats;
}



