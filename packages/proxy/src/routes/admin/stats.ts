import { Hono } from "hono";
import { db } from "../../db/index.js";
import { requestLogs, apiKeys, devices, chatSessions } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { getModelRates } from "../../utils/cost-calculator.js";
import { COUNTED_LOG_SQL, BILLABLE_LOG_SQL, VALID_LOG_SQL, wibMonthStartSql, wibTodayStartSql } from "../../utils/counting.js";

const stats = new Hono();

/** Convert a Date to the 'YYYY-MM-DD HH:MM:SS' format stored in SQLite (UTC-based). */
function toSqliteUtc(date: Date): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Return "today" midnight in LOCAL server time, formatted as SQLite UTC string.
 * SQLite stores timestamps as UTC strings without timezone — comparing with
 * local-midnight ISO string gives correct "today" results regardless of server TZ.
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
  const todayStart  = localTodayStart();
  const weekStart   = new Date(todayStart.getTime() - 7  * 86400000);
  // month: 1st of current month at local midnight
  const monthStart  = new Date(todayStart); monthStart.setDate(1);

  const todayStr  = toSqliteUtc(todayStart);
  const weekStr   = toSqliteUtc(weekStart);
  const monthStr  = toSqliteUtc(monthStart);

  // Today
  const todayStats = await db.select({
    requests: sql<number>`SUM(CASE WHEN ${COUNTED_LOG_SQL} THEN 1 ELSE 0 END)`,
    tokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN total_tokens ELSE 0 END), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN prompt_tokens ELSE 0 END), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN completion_tokens ELSE 0 END), 0)`,
    contextTokens: sql<number>`0`,
    uniqueDevices: sql<number>`COUNT(DISTINCT device_fingerprint)`
  })
  .from(requestLogs)
  .where(and(sql`created_at >= ${todayStr}`, sql`is_counted_request IS NOT 0`))
  .get();

  const todayBreakdown = await db.select({
    model: requestLogs.model,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`
  })
  .from(requestLogs)
  .where(and(sql`created_at >= ${todayStr}`, sql`is_counted_request IS NOT 0`))
  .groupBy(requestLogs.model)
  .all();
  const todayCosts = calculateBreakdownCosts(todayBreakdown);

  // Week
  const weekStats = await db.select({
    requests: sql<number>`SUM(CASE WHEN ${COUNTED_LOG_SQL} THEN 1 ELSE 0 END)`,
    tokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN total_tokens ELSE 0 END), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN prompt_tokens ELSE 0 END), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN completion_tokens ELSE 0 END), 0)`,
    contextTokens: sql<number>`0`
  })
  .from(requestLogs)
  .where(and(sql`created_at >= ${weekStr}`, sql`is_counted_request IS NOT 0`))
  .get();

  const weekBreakdown = await db.select({
    model: requestLogs.model,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`
  })
  .from(requestLogs)
  .where(and(sql`created_at >= ${weekStr}`, sql`is_counted_request IS NOT 0`))
  .groupBy(requestLogs.model)
  .all();
  const weekCosts = calculateBreakdownCosts(weekBreakdown);

  // Month
  const monthStats = await db.select({
    requests: sql<number>`SUM(CASE WHEN ${COUNTED_LOG_SQL} THEN 1 ELSE 0 END)`,
    tokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN total_tokens ELSE 0 END), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN prompt_tokens ELSE 0 END), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN completion_tokens ELSE 0 END), 0)`,
    contextTokens: sql<number>`0`
  })
  .from(requestLogs)
  .where(and(sql`created_at >= ${monthStr}`, sql`is_counted_request IS NOT 0`))
  .get();

  const monthBreakdown = await db.select({
    model: requestLogs.model,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`
  })
  .from(requestLogs)
  .where(and(sql`created_at >= ${monthStr}`, sql`is_counted_request IS NOT 0`))
  .groupBy(requestLogs.model)
  .all();
  const monthCosts = calculateBreakdownCosts(monthBreakdown);

  // All Time
  const allTimeStats = await db.select({
    requests: sql<number>`SUM(CASE WHEN ${COUNTED_LOG_SQL} THEN 1 ELSE 0 END)`,
    tokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN total_tokens ELSE 0 END), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN prompt_tokens ELSE 0 END), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN completion_tokens ELSE 0 END), 0)`,
    contextTokens: sql<number>`0`
  })
  .from(requestLogs)
  .where(sql`is_counted_request IS NOT 0`)
  .get();

  const allTimeBreakdown = await db.select({
    model: requestLogs.model,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`
  })
  .from(requestLogs)
  .where(sql`is_counted_request IS NOT 0`)
  .groupBy(requestLogs.model)
  .all();
  const allTimeCosts = calculateBreakdownCosts(allTimeBreakdown);

  const activeKeys = await db.select({ count: sql<number>`count(*)` }).from(apiKeys).where(eq(apiKeys.isActive, true)).get();
  const totalKeys = await db.select({ count: sql<number>`count(*)` }).from(apiKeys).get();
  const totalDevices = await db.select({ count: sql<number>`count(*)` }).from(devices).get();
  
  // Sessions & Average calculations
  const sessionCountResult = await db.select({ count: sql<number>`count(*)` }).from(chatSessions).get();
  const totalSessions = sessionCountResult?.count || 0;
  const avgRequestsPerSession = totalSessions > 0 ? (allTimeStats?.requests || 0) / totalSessions : 0;

  return c.json({
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
  });
});

stats.get("/stats/by-key", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  const allKeys = await db.select().from(apiKeys).all();
  const result = [];
  for (const key of allKeys) {
    const whereClause = startDate
      ? and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${startDate}`, sql`is_counted_request IS NOT 0`)
      : and(eq(requestLogs.apiKeyId, key.id), sql`is_counted_request IS NOT 0`);

    const keyStats = await db.select({
      requests: sql<number>`count(*)`,
      tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
      promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
      completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
      uniqueDevices: sql<number>`COUNT(DISTINCT device_fingerprint)`
    }).from(requestLogs).where(whereClause).get();

    const topModel = await db.select({ model: requestLogs.model, count: sql<number>`count(*)` })
      .from(requestLogs).where(whereClause).groupBy(requestLogs.model).orderBy(sql`count(*) DESC`).limit(1).get();

    const modelBreakdown = await db.select({
      model: requestLogs.model,
      promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
      completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
    }).from(requestLogs).where(whereClause).groupBy(requestLogs.model).all();

    let estimatedCost = 0;
    for (const row of modelBreakdown) {
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
  return c.json(result);
});

stats.get("/stats/by-model", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const apiKeyId = c.req.query("api_key_id") ? parseInt(c.req.query("api_key_id")!) : null;
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  const conditions = [];
  if (startDate) conditions.push(sql`created_at >= ${startDate}`);
  conditions.push(VALID_LOG_SQL);
  if (apiKeyId) conditions.push(eq(requestLogs.apiKeyId, apiKeyId));
  const whereClause = conditions.length > 1 ? and(...(conditions as [any, ...any[]])) : conditions[0];

  const result = await db.select({
    model: requestLogs.model, requests: sql<number>`count(*)`,
    tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
    avgLatency: sql<number>`ROUND(AVG(latency_ms), 0)`,
  }).from(requestLogs).where(whereClause).groupBy(requestLogs.model).orderBy(sql`count(*) DESC`).all();

  const withCost = result.map(row => {
    const rates = getModelRates(row.model || "");
    const estimatedCost = Math.round(
      (row.promptTokens || 0) * rates.prompt + (row.completionTokens || 0) * rates.completion
    );
    return { ...row, estimatedCost };
  });

  return c.json(withCost);
});

stats.get("/stats/by-device", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  const whereClause = startDate
    ? and(sql`created_at >= ${startDate}`, VALID_LOG_SQL)
    : VALID_LOG_SQL;

  const rows = await db.select({
    fingerprint: requestLogs.deviceFingerprint, ipAddress: requestLogs.ipAddress, ide: requestLogs.ideDetected,
    requests: sql<number>`count(*)`, tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
    lastSeen: sql<string>`MAX(created_at)`,
  }).from(requestLogs).where(whereClause).groupBy(requestLogs.deviceFingerprint).orderBy(sql`count(*) DESC`).limit(50).all();

  // Compute estimated cost per device (all models lumped together, use average rate)
  const result = rows.map(row => {
    // Use a simple per-device heuristic: total tokens * average cost
    // We don't have model breakdown per device here, so use DEFAULT per-token rate
    const estimatedCost = Math.round((row.promptTokens || 0) * 1.50 + (row.completionTokens || 0) * 6.00);
    return { ...row, estimatedCost };
  });

  return c.json(result);
});

stats.get("/stats/timeseries", async (c) => {
  const period = c.req.query("period") || "daily";
  const days = parseInt(c.req.query("days") || "7");
  // Use UTC-based rolling window to match UTC timestamps stored in DB
  const startDate = new Date(Date.now() - days * 86400000);
  const startStr = toSqliteUtc(startDate);

  const groupExpr = period === "hourly" ? "strftime('%Y-%m-%d %H:00', created_at)" : "strftime('%Y-%m-%d', created_at)";

  const result = await db.select({
    period: sql<string>`${sql.raw(groupExpr)}`.as("period"),
    requests: sql<number>`count(*)`, tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`, completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
    estimatedCost: sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    uniqueDevices: sql<number>`COUNT(DISTINCT device_fingerprint)`,
  }).from(requestLogs).where(and(sql`created_at >= ${startStr}`, VALID_LOG_SQL))
    .groupBy(sql.raw(groupExpr)).orderBy(sql.raw(groupExpr)).all();

  return c.json(result);
});

// ─── Top Users ────────────────────────────────────────────────────────────────
stats.get("/stats/top-users", async (c) => {
  const days = parseInt(c.req.query("days") || "0");
  const startDate = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").substring(0, 19)
    : null;

  const whereClause = startDate
    ? and(sql`created_at >= ${startDate}`, VALID_LOG_SQL)
    : VALID_LOG_SQL;

  // Aggregate per api_key_id
  const aggRows = await db.select({
    apiKeyId: requestLogs.apiKeyId,
    requests: sql<number>`SUM(CASE WHEN ${COUNTED_LOG_SQL} THEN 1 ELSE 0 END)`,
    tokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN total_tokens ELSE 0 END), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN prompt_tokens ELSE 0 END), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(CASE WHEN ${BILLABLE_LOG_SQL} THEN completion_tokens ELSE 0 END), 0)`,
  })
  .from(requestLogs)
  .where(whereClause)
  .groupBy(requestLogs.apiKeyId)
  .all();

  // Join with api_keys for display info
  const enriched = await Promise.all(
    aggRows
      .filter(r => r.apiKeyId != null)
      .map(async r => {
        const key = await db.select({
          name: apiKeys.name,
          discordUserId: apiKeys.discordUserId,
          discordUsername: apiKeys.discordUsername,
        }).from(apiKeys).where(eq(apiKeys.id, r.apiKeyId!)).get();

        const displayName = key?.discordUsername
          || (key?.discordUserId ? `Discord #${key.discordUserId.substring(0, 8)}` : null)
          || key?.name
          || `Key #${r.apiKeyId}`;

        // Per-row cost estimate using average rates (no model breakdown here)
        const estimatedCost = Math.round((r.promptTokens || 0) * 1.5 + (r.completionTokens || 0) * 6.0);

        return {
          keyName: key?.name || `Key #${r.apiKeyId}`,
          displayName,
          discordUserId: key?.discordUserId || null,
          requests: r.requests,
          tokens: r.tokens,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          estimatedCost,
        };
      })
  );

  // Sort copies for by-requests and by-tokens
  const byRequests = [...enriched].sort((a, b) => b.requests - a.requests).slice(0, 10);
  const byTokens   = [...enriched].sort((a, b) => b.tokens   - a.tokens  ).slice(0, 10);

  return c.json({ byRequests, byTokens });
});

export default stats;
