import { Hono } from "hono";
import { db } from "../../db/index.js";
import { requestLogs, apiKeys, devices, chatSessions, monthlyStats } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { getModelRates } from "../../utils/cost-calculator.js";
import { COUNTED_LOG_SQL, BILLABLE_LOG_SQL, VALID_LOG_SQL, wibMonthStartSql, wibTodayStartSql, turnCountSql, turnPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql } from "../../utils/counting.js";
import { statsCache } from "../../utils/cache.js";

const stats = new Hono();

/** Convert a Date to the 'YYYY-MM-DD HH:MM:SS' UTC string for DB comparison. */
function toUtcStr(date: Date): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
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
  return c.json(await statsCache.getOrFetch("overview", async () => {
  const todayStart  = localTodayStart();
  const weekStart   = new Date(todayStart.getTime() - 7  * 86400000);
  // month: 1st of current month at local midnight
  const monthStart  = new Date(todayStart); monthStart.setDate(1);

  const todayStr  = toUtcStr(todayStart);
  const weekStr   = toUtcStr(weekStart);
  const monthStr  = toUtcStr(monthStart);

  // Today — turn-based aggregation (MAX prompt per turn, SUM completion per turn)
  const todayWhere = and(sql`created_at >= ${todayStr}`, VALID_LOG_SQL);
  const todayStats = (await db.select({
    requests: turnCountSql(todayWhere),
    tokens: turnTotalTokensSql(todayWhere),
    promptTokens: turnPromptTokensSql(todayWhere),
    completionTokens: turnCompletionTokensSql(todayWhere),
    contextTokens: sql<number>`0`,
    uniqueDevices: sql<number>`COUNT(DISTINCT device_fingerprint)`
  })
  .from(requestLogs)
  .where(todayWhere))[0];

  const todayBreakdown = (await db.execute(sql`
    SELECT model, COALESCE(SUM(sum_delta), 0) as promptTokens, COALESCE(SUM(sum_c), 0) as completionTokens
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE created_at >= ${todayStr} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
      UNION ALL
      SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE model LIKE 'auto (%)%' AND created_at >= ${todayStr} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
    )
    GROUP BY model
  `)).rows;
  const todayCosts = calculateBreakdownCosts(todayBreakdown as any);

  // Week
  const weekWhere = and(sql`created_at >= ${weekStr}`, VALID_LOG_SQL);
  const weekStats = (await db.select({
    requests: turnCountSql(weekWhere),
    tokens: turnTotalTokensSql(weekWhere),
    promptTokens: turnPromptTokensSql(weekWhere),
    completionTokens: turnCompletionTokensSql(weekWhere),
    contextTokens: sql<number>`0`
  })
  .from(requestLogs)
  .where(weekWhere))[0];

  const weekBreakdown = (await db.execute(sql`
    SELECT model, COALESCE(SUM(sum_delta), 0) as promptTokens, COALESCE(SUM(sum_c), 0) as completionTokens
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE created_at >= ${weekStr} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
      UNION ALL
      SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE model LIKE 'auto (%)%' AND created_at >= ${weekStr} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
    )
    GROUP BY model
  `)).rows;
  const weekCosts = calculateBreakdownCosts(weekBreakdown as any);

  // Month
  const monthWhere = and(sql`created_at >= ${monthStr}`, VALID_LOG_SQL);
  const monthStats = (await db.select({
    requests: turnCountSql(monthWhere),
    tokens: turnTotalTokensSql(monthWhere),
    promptTokens: turnPromptTokensSql(monthWhere),
    completionTokens: turnCompletionTokensSql(monthWhere),
    contextTokens: sql<number>`0`
  })
  .from(requestLogs)
  .where(monthWhere))[0];

  const monthBreakdown = (await db.execute(sql`
    SELECT model, COALESCE(SUM(sum_delta), 0) as promptTokens, COALESCE(SUM(sum_c), 0) as completionTokens
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE created_at >= ${monthStr} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
      UNION ALL
      SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE model LIKE 'auto (%)%' AND created_at >= ${monthStr} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
    )
    GROUP BY model
  `)).rows;
  const monthCosts = calculateBreakdownCosts(monthBreakdown as any);

  // All Time - live data
  const allTimeWhere = VALID_LOG_SQL;
  const allTimeLive = (await db.select({
    requests: turnCountSql(allTimeWhere),
    tokens: turnTotalTokensSql(allTimeWhere),
    promptTokens: turnPromptTokensSql(allTimeWhere),
    completionTokens: turnCompletionTokensSql(allTimeWhere),
    contextTokens: sql<number>`0`
  })
  .from(requestLogs)
  .where(allTimeWhere))[0];

  // All Time - archived data from monthly_stats (survives 3-month cleanup)
  const allTimeArchived = (await db.select({
    requests: sql<number>`COALESCE(SUM(turn_count), 0)`,
    tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(input_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(output_tokens), 0)`,
  })
  .from(monthlyStats)
  .where(sql`api_key_id IS NULL AND model = '_all_'`))[0];

  // Combine live + archived
  const allTimeStats = {
    requests: (allTimeLive?.requests || 0) + (allTimeArchived?.requests || 0),
    tokens: (allTimeLive?.tokens || 0) + (allTimeArchived?.tokens || 0),
    promptTokens: (allTimeLive?.promptTokens || 0) + (allTimeArchived?.promptTokens || 0),
    completionTokens: (allTimeLive?.completionTokens || 0) + (allTimeArchived?.completionTokens || 0),
    contextTokens: 0,
  };

  // All Time breakdown - live data
  const allTimeLiveBreakdown = (await db.execute(sql`
    SELECT model, COALESCE(SUM(sum_delta), 0) as promptTokens, COALESCE(SUM(sum_c), 0) as completionTokens
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
      UNION ALL
      SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE model LIKE 'auto (%)%' AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
    )
    GROUP BY model
  `)).rows;

  // All Time breakdown - archived model data
  const allTimeArchivedBreakdown = await db.select({
    model: monthlyStats.model,
    promptTokens: sql<number>`COALESCE(SUM(input_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(output_tokens), 0)`,
  })
  .from(monthlyStats)
  .where(sql`api_key_id IS NULL AND model != '_all_'`)
  .groupBy(monthlyStats.model);

  // Merge live and archived breakdowns by model
  const breakdownMap = new Map<string, { promptTokens: number; completionTokens: number }>();
  for (const row of allTimeLiveBreakdown as any[]) {
    breakdownMap.set(row.model, { promptTokens: row.promptTokens, completionTokens: row.completionTokens });
  }
  for (const row of allTimeArchivedBreakdown as any[]) {
    const existing = breakdownMap.get(row.model);
    if (existing) {
      existing.promptTokens += row.promptTokens;
      existing.completionTokens += row.completionTokens;
    } else {
      breakdownMap.set(row.model, { promptTokens: row.promptTokens, completionTokens: row.completionTokens });
    }
  }
  const allTimeBreakdown = Array.from(breakdownMap.entries()).map(([model, v]) => ({ model, ...v }));
  const allTimeCosts = calculateBreakdownCosts(allTimeBreakdown as any);

  const activeKeys = (await db.select({ count: sql<number>`count(*)` }).from(apiKeys).where(eq(apiKeys.isActive, true)))[0];
  const totalKeys = (await db.select({ count: sql<number>`count(*)` }).from(apiKeys))[0];
  const totalDevices = (await db.select({ count: sql<number>`count(*)` }).from(devices))[0];
  
  // Sessions & Average calculations
  const sessionCountResult = (await db.select({ count: sql<number>`count(*)` }).from(chatSessions))[0];
  const totalSessions = sessionCountResult?.count || 0;
  const avgRequestsPerSession = totalSessions > 0 ? (allTimeStats?.requests || 0) / totalSessions : 0;

  return {
    today: { 
      requests: todayStats?.requests || 0, 
      tokens: todayStats?.tokens || 0,
      promptTokens: todayStats?.promptTokens || 0,
      completionTokens: todayStats?.completionTokens || 0,
      contextTokens: todayStats?.contextTokens || 0,
      promptCost: todayCosts.promptCost,
      completionCost: todayCosts.completionCost,
      totalCost: todayCosts.totalCost,
      uniqueDevices: todayStats?.uniqueDevices || 0 
    },
    week: { 
      requests: weekStats?.requests || 0, 
      tokens: weekStats?.tokens || 0,
      promptTokens: weekStats?.promptTokens || 0,
      completionTokens: weekStats?.completionTokens || 0,
      contextTokens: weekStats?.contextTokens || 0,
      promptCost: weekCosts.promptCost,
      completionCost: weekCosts.completionCost,
      totalCost: weekCosts.totalCost
    },
    month: { 
      requests: monthStats?.requests || 0, 
      tokens: monthStats?.tokens || 0,
      promptTokens: monthStats?.promptTokens || 0,
      completionTokens: monthStats?.completionTokens || 0,
      contextTokens: monthStats?.contextTokens || 0,
      promptCost: monthCosts.promptCost,
      completionCost: monthCosts.completionCost,
      totalCost: monthCosts.totalCost
    },
    allTime: { 
      requests: allTimeStats?.requests || 0, 
      tokens: allTimeStats?.tokens || 0,
      promptTokens: allTimeStats?.promptTokens || 0,
      completionTokens: allTimeStats?.completionTokens || 0,
      contextTokens: allTimeStats?.contextTokens || 0,
      promptCost: allTimeCosts.promptCost,
      completionCost: allTimeCosts.completionCost,
      totalCost: allTimeCosts.totalCost,
      totalSessions,
      avgRequestsPerSession
    },
    activeKeys: activeKeys?.count || 0, totalKeys: totalKeys?.count || 0, totalDevices: totalDevices?.count || 0,
  };
  })); // end statsCache.getOrFetch
});

stats.get("/stats/by-key", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const cacheKey = `by-key:${days}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  const allKeys = await db.select().from(apiKeys);
  const result = [];
  for (const key of allKeys) {
    const whereClause = startDate
      ? and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${startDate}`, VALID_LOG_SQL)
      : and(eq(requestLogs.apiKeyId, key.id), VALID_LOG_SQL);

    const keyStats = (await db.select({
      requests: turnCountSql(whereClause),
      tokens: turnTotalTokensSql(whereClause),
      promptTokens: turnPromptTokensSql(whereClause),
      completionTokens: turnCompletionTokensSql(whereClause),
      uniqueDevices: sql<number>`COUNT(DISTINCT device_fingerprint)`
    }).from(requestLogs).where(whereClause))[0];

    const topModel = (await db.select({ model: requestLogs.model, count: sql<number>`count(*)` })
      .from(requestLogs).where(whereClause).groupBy(requestLogs.model).orderBy(sql`count(*) DESC`).limit(1))[0];

    const modelBreakdown = (await db.execute(sql`
      SELECT model, COALESCE(SUM(max_p), 0) as promptTokens, COALESCE(SUM(sum_c), 0) as completionTokens
      FROM (SELECT model, turn_id, MAX(prompt_tokens) as max_p, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${key.id} ${startDate ? sql`AND created_at >= ${startDate}` : sql``} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY model, turn_id)
      GROUP BY model
    `)).rows;

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
  return result;
  })); // end statsCache.getOrFetch
});

stats.get("/stats/by-model", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const apiKeyId = c.req.query("api_key_id") ? parseInt(c.req.query("api_key_id")!) : null;
  const cacheKey = `by-model:${days}:${apiKeyId}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  // Build WHERE fragments for raw SQL
  const dateFilter = startDate ? sql`AND created_at >= ${startDate}` : sql``;
  const keyFilter = apiKeyId ? sql`AND api_key_id = ${apiKeyId}` : sql``;

  const rows = (await db.execute(sql`
    SELECT
      model,
      COUNT(*) as turns,
      COALESCE(SUM(sum_delta), 0) as tokens,
      COALESCE(SUM(sum_delta), 0) as promptTokens,
      COALESCE(SUM(sum_c), 0) as completionTokens,
      ROUND(AVG(avg_lat)::numeric, 0) as avgLatency
    FROM (
      SELECT
        CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c, AVG(latency_ms) as avg_lat
      FROM request_logs
      WHERE turn_id IS NOT NULL ${dateFilter} ${keyFilter} AND status_code BETWEEN 200 AND 299
      GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id

      UNION ALL

      SELECT
        TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c, AVG(latency_ms) as avg_lat
      FROM request_logs
      WHERE model LIKE 'auto (%)%' AND turn_id IS NOT NULL ${dateFilter} ${keyFilter} AND status_code BETWEEN 200 AND 299
      GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
    )
    GROUP BY model
    ORDER BY turns DESC
  `)).rows;

  const withCost = (rows as any[]).map(row => {
    const rates = getModelRates(row.model || "");
    const estimatedCost = Math.round(
      (row.promptTokens || 0) * rates.prompt + (row.completionTokens || 0) * rates.completion
    );
    return { ...row, estimatedCost };
  });

  return withCost;
  })); // end statsCache.getOrFetch
});

stats.get("/stats/by-device", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  const dateFilter = startDate ? sql`AND created_at >= ${startDate}` : sql``;

  const rows = (await db.execute(sql`
    SELECT
      device_fingerprint as fingerprint,
      ide_detected as ide,
      ip_address as ipAddress,
      COUNT(*) as requests,
      COALESCE(SUM(max_p), 0) as tokens,
      COALESCE(SUM(max_p), 0) as promptTokens,
      COALESCE(SUM(sum_c), 0) as completionTokens,
      MAX(last_seen) as lastSeen
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
  `)).rows;

  const result = (rows as any[]).map(row => {
    const estimatedCost = Math.round((row.promptTokens || 0) * 1.50 + (row.completionTokens || 0) * 6.00);
    return { ...row, estimatedCost };
  });

  return c.json(result);
});

stats.get("/stats/timeseries", async (c) => {
  const period = c.req.query("period") || "daily";
  const days = parseInt(c.req.query("days") || "7");
  const startDate = new Date(Date.now() - days * 86400000);
  const startStr = toUtcStr(startDate);

  const groupExpr = period === "hourly" ? sql`to_char(created_at, 'YYYY-MM-DD HH24:00')` : sql`to_char(created_at, 'YYYY-MM-DD')`;

  const result = (await db.execute(sql`
    SELECT
      period_group as period,
      COUNT(*) as requests,
      COALESCE(SUM(sum_delta + sum_c), 0) as tokens,
      COALESCE(SUM(sum_delta), 0) as promptTokens,
      COALESCE(SUM(sum_c), 0) as completionTokens,
      0 as estimatedCost,
      0 as uniqueDevices
    FROM (
      SELECT
        ${groupExpr} as period_group,
        turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE created_at >= ${startStr} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY ${groupExpr}, turn_id
    ) sub
    GROUP BY period_group
    ORDER BY period_group
  `)).rows;

  return c.json(result);
});

// ─── Top Users ────────────────────────────────────────────────────────────────
stats.get("/stats/top-users", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const cacheKey = `top-users:${days}`;
  return c.json(await statsCache.getOrFetch(cacheKey, async () => {
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  const dateFilter = startDate ? sql`AND created_at >= ${startDate}` : sql``;

  // Aggregate per api_key_id using turn-level token aggregation
  const aggRows = (await db.execute(sql`
    SELECT
      api_key_id as apiKeyId,
      COUNT(*) as turns,
      COALESCE(SUM(sum_delta + sum_c), 0) as tokens,
      COALESCE(SUM(sum_delta), 0) as promptTokens,
      COALESCE(SUM(sum_c), 0) as completionTokens
    FROM (
      SELECT api_key_id, turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE turn_id IS NOT NULL ${dateFilter} AND status_code BETWEEN 200 AND 299
      GROUP BY api_key_id, turn_id
    )
    GROUP BY api_key_id
  `)).rows;

  // Join with api_keys for display info
  const enriched = await Promise.all(
    (aggRows as any[])
      .filter(r => r.apiKeyId != null)
      .map(async (r: any) => {
        const key = (await db.select({
          name: apiKeys.name,
          discordUserId: apiKeys.discordUserId,
          discordUsername: apiKeys.discordUsername,
        }).from(apiKeys).where(eq(apiKeys.id, r.apiKeyId!)))[0];

        const displayName = key?.discordUsername
          || (key?.discordUserId ? `Discord #${key.discordUserId.substring(0, 8)}` : null)
          || key?.name
          || `Key #${r.apiKeyId}`;

        const estimatedCost = Math.round((r.promptTokens || 0) * 1.5 + (r.completionTokens || 0) * 6.0);

        return {
          keyName: key?.name || `Key #${r.apiKeyId}`,
          displayName,
          discordUserId: key?.discordUserId || null,
          turns: r.turns,
          tokens: r.tokens,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          estimatedCost,
        };
      })
  );

  const byTurns = [...enriched].sort((a, b) => b.turns - a.turns).slice(0, 10);
  const byTokens = [...enriched].sort((a, b) => b.tokens - a.tokens).slice(0, 10);

  return { byTurns, byTokens };
  })); // end statsCache.getOrFetch
});

export default stats;
