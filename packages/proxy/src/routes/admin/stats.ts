import { Hono } from "hono";
import { db } from "../../db/index.js";
import { requestLogs, apiKeys, devices, chatSessions, monthlyStats } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { getModelRates } from "../../utils/cost-calculator.js";
import { VALID_LOG_SQL, BILLABLE_LOG_SQL, turnCountSql, hopCountSql, turnDisplayCompletionTokensSql, turnBillablePromptTokensSql, turnCachedTokensSql, peakPromptTokensSql, hopFullInputTokensSql, weightedHopInputTokensSql, weightedHopTotalTokensSql, sanitizeRows, resolvePeriodRange, groupedInputSumSql, modelLimitCreditBreakdownSql, hopWeightedTimeseriesSql, type PeriodKey } from "../../utils/counting.js";
import { applyTokenMultiplierRows, getTokenMultipliers } from "../../utils/token-multiplier.js";
import { statsCache } from "../../utils/cache.js";
import {
  getAccountUsageAggregates,
  sortTopByRequests,
  sortTopByTokens,
} from "../../utils/account-usage-stats.js";

const stats = new Hono();

/** Convert a Date to the 'YYYY-MM-DD HH:MM:SS' UTC string for DB comparison. */
function toUtcStr(date: Date): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
}

/** Return a Date object for use in Drizzle parameterized queries against timestamp columns. */
function toUtcDate(date: Date): Date {
  return date;
}

/**
 * Return "today" midnight in LOCAL server time as a UTC Date.
 * Timestamps are stored as UTC strings — comparing with local-midnight ISO
 * string gives correct "today" results regardless of server TZ.
 */
function localTodayStart(): Date {
  // Use WIB (UTC+7) as the reference timezone
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset);
}

function calculateBreakdownCosts(modelBreakdown: Array<{ model: string | null, promptTokens: number, completionTokens: number }>) {
  let promptCost = 0;
  let completionCost = 0;
  for (const row of modelBreakdown) {
    const rates = getModelRates(row.model || "");
    promptCost += row.promptTokens * rates.prompt;
    completionCost += row.completionTokens * rates.completion;
  }
  return {
    promptCost: Math.round(promptCost),
    completionCost: Math.round(completionCost),
    totalCost: Math.round(promptCost + completionCost)
  };
}

stats.get("/stats/overview", async (c) => {
  const rawPeriod = (c.req.query("period") || "today") as PeriodKey;
  const period: PeriodKey = [
    "today", "3d", "7d", "30d", "thisMonth", "lastMonth", "allTime",
  ].includes(rawPeriod)
    ? rawPeriod
    : "today";

  return c.json(await statsCache.getOrFetch(`overview:v3:${period}`, async () => {
    const range = resolvePeriodRange(period);
    const start = period === "allTime" ? null : range.start;
    const periodWhere = start
      ? and(sql`created_at >= ${start}`, VALID_LOG_SQL)
      : VALID_LOG_SQL;
    const dateFilter = start
      ? sql`AND created_at >= ${start}`
      : sql``;

    const [
      periodStats,
      periodBreakdownRaw,
      activeKeys,
      totalKeys,
      totalDevices,
      sessionCountResult,
      allTimeArchivedRaw,
      allTimeArchivedBreakdown,
    ] = await Promise.all([
      db.select({
        requests: turnCountSql(periodWhere),
        apiCalls: hopCountSql(periodWhere),
        tokens: weightedHopTotalTokensSql(periodWhere),
        promptTokens: weightedHopInputTokensSql(periodWhere),
        billablePromptTokens: turnBillablePromptTokensSql(periodWhere),
        cachedTokens: turnCachedTokensSql(periodWhere),
        completionTokens: turnDisplayCompletionTokensSql(periodWhere),
        contextTokens: sql<number>`0`,
        uniqueDevices: sql<number>`COUNT(DISTINCT device_fingerprint)`,
      })
        .from(requestLogs)
        .where(periodWhere)
        .then((r) => r[0]),
      db.execute(sql`
        SELECT model, COALESCE(SUM(sum_delta), 0) as "promptTokens", COALESCE(SUM(sum_c), 0) as "completionTokens"
        FROM (
          SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
            turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
          FROM request_logs
          WHERE status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL ${dateFilter}
          GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
          UNION ALL
          SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
            turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
          FROM request_logs
          WHERE model LIKE 'auto (%)%' AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL ${dateFilter}
          GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
        )
        GROUP BY model
      `),
      db.select({ count: sql<number>`count(*)` }).from(apiKeys).where(eq(apiKeys.isActive, true)).then((r) => r[0]),
      db.select({ count: sql<number>`count(*)` }).from(apiKeys).then((r) => r[0]),
      db.select({ count: sql<number>`count(*)` }).from(devices).then((r) => r[0]),
      db.select({ count: sql<number>`count(*)` }).from(chatSessions).then((r) => r[0]),
      period === "allTime"
        ? db.select({
            requests: sql<number>`COALESCE(SUM(turn_count), 0)`,
            tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
            promptTokens: sql<number>`COALESCE(SUM(input_tokens), 0)`,
            completionTokens: sql<number>`COALESCE(SUM(output_tokens), 0)`,
          })
            .from(monthlyStats)
            .where(sql`api_key_id IS NULL AND model = '_all_'`)
            .then((r) => r[0])
        : Promise.resolve(null),
      period === "allTime"
        ? db.select({
            model: monthlyStats.model,
            promptTokens: sql<number>`COALESCE(SUM(input_tokens), 0)`,
            completionTokens: sql<number>`COALESCE(SUM(output_tokens), 0)`,
          })
            .from(monthlyStats)
            .where(sql`api_key_id IS NULL AND model != '_all_'`)
            .groupBy(monthlyStats.model)
        : Promise.resolve([] as any[]),
    ]);

    let requests = Number(periodStats?.requests) || 0;
    let apiCalls = Number(periodStats?.apiCalls) || 0;
    let tokens = Number(periodStats?.tokens) || 0;
    let promptTokens = Number(periodStats?.promptTokens) || 0;
    let billablePromptTokens = Number(periodStats?.billablePromptTokens) || 0;
    let cachedTokens = Number(periodStats?.cachedTokens) || 0;
    let completionTokens = Number(periodStats?.completionTokens) || 0;
    const uniqueDevices = Number(periodStats?.uniqueDevices) || 0;

    let breakdown = applyTokenMultiplierRows(
      sanitizeRows(
        (periodBreakdownRaw.rows as any[]) || [],
        ["promptTokens", "completionTokens"],
      ),
    ) as any[];

    if (period === "allTime" && allTimeArchivedRaw) {
      const archived = applyTokenMultiplierRows([{
        ...allTimeArchivedRaw,
        promptTokens: Number(allTimeArchivedRaw.promptTokens) || 0,
        completionTokens: Number(allTimeArchivedRaw.completionTokens) || 0,
        tokens: Number(allTimeArchivedRaw.tokens) || 0,
      }])[0];
      requests += Number(allTimeArchivedRaw.requests) || 0;
      // archived monthly_stats has no hop count
      tokens += Number(archived?.tokens) || 0;
      promptTokens += Number(archived?.promptTokens) || 0;
      billablePromptTokens += Number(archived?.promptTokens) || 0;
      completionTokens += Number(archived?.completionTokens) || 0;

      const archivedBd = applyTokenMultiplierRows(
        (allTimeArchivedBreakdown as any[]).map((r) => ({
          ...r,
          promptTokens: Number(r.promptTokens) || 0,
          completionTokens: Number(r.completionTokens) || 0,
        })),
      );
      const breakdownMap = new Map<string, { promptTokens: number; completionTokens: number }>();
      for (const row of breakdown) {
        breakdownMap.set(row.model, {
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
        });
      }
      for (const row of archivedBd as any[]) {
        const existing = breakdownMap.get(row.model);
        if (existing) {
          existing.promptTokens += row.promptTokens;
          existing.completionTokens += row.completionTokens;
        } else {
          breakdownMap.set(row.model, {
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
          });
        }
      }
      breakdown = Array.from(breakdownMap.entries()).map(([model, v]) => ({
        model,
        ...v,
      }));
    }

    const costs = calculateBreakdownCosts(breakdown as any);
    const totalSessions = Number(sessionCountResult?.count) || 0;
    const avgRequestsPerSession =
      totalSessions > 0 ? requests / totalSessions : 0;

    const statsPayload = {
      requests,
      apiCalls,
      tokens,
      promptTokens,
      billablePromptTokens,
      cachedTokens,
      completionTokens,
      contextTokens: 0,
      promptCost: costs.promptCost,
      completionCost: costs.completionCost,
      totalCost: costs.totalCost,
      uniqueDevices,
      totalSessions,
      avgRequestsPerSession,
    };

    return {
      period,
      stats: statsPayload,
      // Backward-compatible aliases so older clients still render something.
      today: period === "today" ? statsPayload : statsPayload,
      week: statsPayload,
      month: statsPayload,
      allTime: statsPayload,
      activeKeys: Number(activeKeys?.count) || 0,
      totalKeys: Number(totalKeys?.count) || 0,
      totalDevices: Number(totalDevices?.count) || 0,
    };
  }));
});

stats.get("/stats/by-key", async (c) => {
  const period = c.req.query("period") as PeriodKey | undefined;
  const legacyDays = parseInt(c.req.query("days") || "0");
  const cacheKey = `by-key:${period || legacyDays}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
  let startDate: Date | null;
  if (period && ["today", "3d", "7d", "30d", "thisMonth", "lastMonth", "allTime"].includes(period)) {
    const range = resolvePeriodRange(period);
    startDate = range.start;
  } else {
    startDate = legacyDays > 0 ? new Date(Date.now() - legacyDays * 86400000) : null;
  }

  const allKeys = await db.select().from(apiKeys);
  const result = [];
  for (const key of allKeys) {
    const whereClause = startDate
      ? and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${startDate}`, VALID_LOG_SQL)
      : and(eq(requestLogs.apiKeyId, key.id), VALID_LOG_SQL);

    const keyStats = (await db.select({
      requests: turnCountSql(whereClause),
      tokens: weightedHopTotalTokensSql(whereClause),
      promptTokens: weightedHopInputTokensSql(whereClause),
      completionTokens: turnDisplayCompletionTokensSql(whereClause),
      uniqueDevices: sql<number>`COUNT(DISTINCT device_fingerprint)`
    }).from(requestLogs).where(whereClause))[0];

    const topModel = (await db.select({ model: requestLogs.model, count: sql<number>`count(*)` })
      .from(requestLogs).where(whereClause).groupBy(requestLogs.model).orderBy(sql`count(*) DESC`).limit(1))[0];

    const modelBreakdown = applyTokenMultiplierRows(sanitizeRows((await db.execute(sql`
      SELECT model, COALESCE(SUM(max_p), 0) as "promptTokens", COALESCE(SUM(sum_c), 0) as "completionTokens"
      FROM (SELECT model, turn_id, MAX(prompt_tokens) as max_p, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${key.id} ${startDate ? sql`AND created_at >= ${startDate}` : sql``} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY model, turn_id)
      GROUP BY model
    `)).rows as any[], ['promptTokens', 'completionTokens']));

    let estimatedCost = 0;
    for (const row of modelBreakdown as any[]) {
      const rates = getModelRates(row.model || "");
      estimatedCost += row.promptTokens * rates.prompt + row.completionTokens * rates.completion;
    }

    result.push({
      id: key.id, name: key.name, isActive: key.isActive,
      requests: keyStats?.requests || 0, tokens: keyStats?.tokens || 0,
      promptTokens: keyStats?.promptTokens || 0, completionTokens: keyStats?.completionTokens || 0,
      estimatedCost: Math.round(estimatedCost),
      uniqueDevices: keyStats?.uniqueDevices || 0, topModel: topModel?.model || "N/A",
    });
  }
  const { withPublicizedModels } = await import("../../utils/vendor-aliases.js");
  return withPublicizedModels(result);
  })); // end statsCache.getOrFetch
});

stats.get("/stats/by-model", async (c) => {
  const period = c.req.query("period") as PeriodKey | undefined;
  const legacyDays = parseInt(c.req.query("days") || "0");
  const apiKeyId = c.req.query("api_key_id") ? parseInt(c.req.query("api_key_id")!) : null;
  const cacheKey = `by-model:credit:v1:${period || legacyDays}:${apiKeyId}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
  let startDate: Date | null;
  if (period && ["today", "3d", "7d", "30d", "thisMonth", "lastMonth", "allTime"].includes(period)) {
    const range = resolvePeriodRange(period);
    startDate = range.start;
  } else {
    startDate = legacyDays > 0 ? new Date(Date.now() - legacyDays * 86400000) : null;
  }

  const dateFilter = startDate ? sql`AND created_at >= ${startDate}` : sql``;
  const keyFilter = apiKeyId ? sql`AND api_key_id = ${apiKeyId}` : sql``;
  const extraWhere = sql`status_code BETWEEN 200 AND 299 ${dateFilter} ${keyFilter}`;

  const rows = sanitizeRows(
    (await db.execute(modelLimitCreditBreakdownSql(extraWhere))).rows as any[],
    ["requests", "promptTokens", "completionTokens", "tokens"],
  );

  const withCost = (rows as any[]).map((row) => {
    const rates = getModelRates(row.model || "");
    const estimatedCost = Math.round(
      (row.promptTokens || 0) * rates.prompt + (row.completionTokens || 0) * rates.completion,
    );
    // tokens already = credit in+out; keep prompt/completion splits for charts
    return {
      ...row,
      avgLatency: 0,
      estimatedCost,
    };
  });

  const { withPublicizedModels } = await import("../../utils/vendor-aliases.js");
  return withPublicizedModels(withCost);
  })); // end statsCache.getOrFetch
});

stats.get("/stats/by-device", async (c) => {
  const period = c.req.query("period") as PeriodKey | undefined;
  const legacyDays = parseInt(c.req.query("days") || "0");
  let startDate: Date | null;
  if (period && ["today", "3d", "7d", "30d", "thisMonth", "lastMonth", "allTime"].includes(period)) {
    const range = resolvePeriodRange(period);
    startDate = range.start;
  } else {
    startDate = legacyDays > 0 ? new Date(Date.now() - legacyDays * 86400000) : null;
  }

  const dateFilter = startDate ? sql`AND created_at >= ${startDate}` : sql``;

  const rows = sanitizeRows((await db.execute(sql`
    SELECT
      device_fingerprint as fingerprint,
      ide_detected as ide,
      ip_address as "ipAddress",
      COUNT(*) as requests,
      COALESCE(SUM(max_p), 0) as tokens,
      COALESCE(SUM(max_p), 0) as "promptTokens",
      COALESCE(SUM(sum_c), 0) as "completionTokens",
      MAX(last_seen) as "lastSeen"
    FROM (
      SELECT device_fingerprint, ide_detected, ip_address, turn_id,
        MAX(prompt_tokens) as max_p,
        SUM(completion_tokens) as sum_c,
        MAX(created_at) as last_seen
      FROM request_logs
      WHERE status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL ${dateFilter}
      GROUP BY device_fingerprint, ide_detected, ip_address, turn_id
    )
    GROUP BY device_fingerprint, ide_detected, ip_address
    ORDER BY requests DESC
    LIMIT 50
  `)).rows as any[], ['requests', 'tokens', 'promptTokens', 'completionTokens']);

  const result = (rows as any[]).map(row => {
    const { input, output } = getTokenMultipliers();
    const promptTokens = Math.round((row.promptTokens || 0) * input);
    const completionTokens = Math.round((row.completionTokens || 0) * output);
    const tokens = Math.round((row.tokens || 0) * input);
    const estimatedCost = Math.round(promptTokens * 1.50 + completionTokens * 6.00);
    return { ...row, promptTokens, completionTokens, tokens, estimatedCost };
  });

  return c.json(result);
});

stats.get("/stats/timeseries", async (c) => {
  // Support new ?period= key (today|3d|7d|30d|thisMonth|lastMonth|allTime)
  // Fallback to legacy ?period=daily|hourly + ?days=N
  // Optional ?api_key_id=N scopes to one key (Key Detail charts).
  // Limit-credit formula — same as gates / Key Detail cards / portal meters.
  const newPeriod = c.req.query("period") as PeriodKey | undefined;
  const legacyPeriod = c.req.query("period") as string | undefined; // daily|hourly
  const days = parseInt(c.req.query("days") || "7");
  const apiKeyRaw = c.req.query("api_key_id");
  const apiKeyId = apiKeyRaw ? parseInt(apiKeyRaw, 10) : NaN;
  const keyScoped = Number.isFinite(apiKeyId) && apiKeyId > 0;
  if (apiKeyRaw && !keyScoped) {
    return c.json({ error: "Invalid api_key_id" }, 400);
  }
  const cacheKey = `timeseries:v4:limitcredit:${newPeriod || legacyPeriod || "daily"}:${days}:k${keyScoped ? apiKeyId : "all"}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
  let startDate: Date;
  let endDate: Date | null = null;
  let groupPeriod: "hourly" | "daily";

  if (newPeriod && ["today", "3d", "7d", "30d", "thisMonth", "lastMonth", "allTime"].includes(newPeriod)) {
    const range = resolvePeriodRange(newPeriod);
    startDate = range.start;
    endDate = range.end;
    groupPeriod = newPeriod === "today" || newPeriod === "3d" ? "hourly" : "daily";
  } else {
    startDate = new Date(Date.now() - days * 86400000);
    groupPeriod = (legacyPeriod === "hourly") ? "hourly" : "daily";
  }

  const keyFilter = keyScoped ? sql`AND api_key_id = ${apiKeyId}` : sql``;
  const endFilter = endDate ? sql`AND created_at <= ${endDate}` : sql``;

  const groupExpr = groupPeriod === "hourly"
    ? sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:00')`
    : sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

  const whereExtra = sql`
    created_at >= ${startDate}
    ${endFilter}
    AND status_code BETWEEN 200 AND 299
    ${keyFilter}
  `;

  const result = sanitizeRows(
    (await db.execute(hopWeightedTimeseriesSql(groupExpr, whereExtra))).rows as any[],
    ["requests", "apiCalls", "tokens", "promptTokens", "completionTokens"],
  ).map((row: any) => ({
    ...row,
    estimatedCost: 0,
    uniqueDevices: 0,
  }));

  return result;
  })); // end statsCache
});

/** Period-aware limit-credit totals (same formula as gates). Used by Key Detail cards. */
stats.get("/stats/period-summary", async (c) => {
  const period = (c.req.query("period") || "today") as PeriodKey;
  if (!["today", "3d", "7d", "30d", "thisMonth", "lastMonth", "allTime"].includes(period)) {
    return c.json({ error: "Invalid period" }, 400);
  }
  const apiKeyRaw = c.req.query("api_key_id");
  const apiKeyId = apiKeyRaw ? parseInt(apiKeyRaw, 10) : NaN;
  if (!apiKeyRaw || !Number.isFinite(apiKeyId) || apiKeyId <= 0) {
    return c.json({ error: "api_key_id required" }, 400);
  }

  const cacheKey = `period-summary:v1:${period}:k${apiKeyId}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
    const range = resolvePeriodRange(period);
    const baseFilters = [
      eq(requestLogs.apiKeyId, apiKeyId),
      sql`created_at >= ${range.start}`,
      ...(range.end ? [sql`created_at <= ${range.end}`] : []),
    ];
    const whereClause = and(...baseFilters, BILLABLE_LOG_SQL)!;
    const whereTurns = and(...baseFilters, VALID_LOG_SQL)!;

    const row = (await db.select({
      requests: turnCountSql(whereTurns),
      apiCalls: hopCountSql(whereTurns),
      tokens: weightedHopTotalTokensSql(whereClause),
      promptTokens: weightedHopInputTokensSql(whereClause),
      peakPromptTokens: peakPromptTokensSql(whereTurns),
      billablePromptTokens: turnBillablePromptTokensSql(whereTurns),
      cachedTokens: turnCachedTokensSql(whereTurns),
      fullInputTokens: hopFullInputTokensSql(whereClause),
      completionTokens: turnDisplayCompletionTokensSql(whereClause),
    }).from(requestLogs).where(whereTurns))[0];

    return {
      period,
      apiKeyId,
      requests: Number(row?.requests) || 0,
      apiCalls: Number(row?.apiCalls) || 0,
      tokens: Number(row?.tokens) || 0,
      promptTokens: Number(row?.promptTokens) || 0,
      peakPromptTokens: Number(row?.peakPromptTokens) || 0,
      billablePromptTokens: Number(row?.billablePromptTokens) || 0,
      cachedTokens: Number(row?.cachedTokens) || 0,
      fullInputTokens: Number(row?.fullInputTokens) || 0,
      completionTokens: Number(row?.completionTokens) || 0,
      contextTokens: 0,
      estimatedCost: 0,
    };
  }));
});

// ─── Top Users (Discord-account scoped, hop-weighted — same as Discord ranking)
stats.get("/stats/top-users", async (c) => {
  const period = c.req.query("period") as PeriodKey | undefined;
  const legacyDays = parseInt(c.req.query("days") || "0");
  const cacheKey = `top-users:v3:${period || legacyDays}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
  let startDate: Date | null;
  if (period && ["today", "3d", "7d", "30d", "thisMonth", "lastMonth", "allTime"].includes(period)) {
    const range = resolvePeriodRange(period);
    startDate = period === "allTime" ? null : range.start;
  } else {
    startDate = legacyDays > 0 ? new Date(Date.now() - legacyDays * 86400000) : null;
  }

  const accounts = await getAccountUsageAggregates(startDate);

  const toRow = (r: (typeof accounts)[0]) => {
    const displayName =
      r.discordUsername ||
      (r.discordUserId ? `Discord #${r.discordUserId.substring(0, 8)}` : null) ||
      r.keyName ||
      "Unknown";
    return {
      keyName: r.keyName || displayName,
      displayName,
      discordUserId: r.discordUserId,
      isTrial: r.isTrial,
      requests: r.requests,
      turns: r.requests,
      apiCalls: r.apiCalls,
      tokens: r.tokens,
      promptTokens: r.promptTokens,
      billablePromptTokens: r.billablePromptTokens,
      cachedTokens: r.cachedTokens,
      completionTokens: r.completionTokens,
      cost: r.estimatedCost,
      estimatedCost: r.estimatedCost,
    };
  };

  return {
    byRequests: sortTopByRequests(accounts).map(toRow),
    byTokens: sortTopByTokens(accounts).map(toRow),
  };
  })); // end statsCache.getOrFetch
});

export default stats;