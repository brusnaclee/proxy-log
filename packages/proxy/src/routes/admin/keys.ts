import { Hono } from "hono";
import { db } from "../../db/index.js";
import { apiKeys, requestLogs, devices, allowedDevices, allowedIdes, chatSessions, adminConfig, modelLimits } from "../../db/schema.js";
import { eq, sql, and, desc } from "drizzle-orm";
import { generateApiKey, getKeyPrefix, sha256, maskKey } from "../../utils/crypto.js";
import { normalizeIdeName } from "../../utils/detect-ide.js";
import { getModelRates } from "../../utils/cost-calculator.js";
import { COUNTED_LOG_SQL, BILLABLE_LOG_SQL, VALID_LOG_SQL, wibMonthStartSql, turnCountSql, turnPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql, sanitizeRows } from "../../utils/counting.js";
import { applyTokenMultiplierRows, getTokenMultipliers } from "../../utils/token-multiplier.js";
import { apiKeyCache, statsCache } from "../../utils/cache.js";
import { getModelCatalogResponse } from "../../utils/model-catalog.js";
import { enrichModelLimitsWithCatalog } from "../../utils/model-limits-enrich.js";

const keys = new Hono();

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

keys.get("/keys", async (c) => {
  return c.json(await statsCache.getOrFetch("keys-list", async () => {
  const allKeys = await db.select().from(apiKeys);
  const config = (await db.select().from(adminConfig))[0];
  const result = [];

  for (const key of allKeys) {
    const _now = new Date();
    const _wibOffset = 7 * 60 * 60 * 1000;
    const _wibNow = new Date(_now.getTime() + _wibOffset);
    _wibNow.setUTCHours(0, 0, 0, 0);
    const _d = new Date(_wibNow.getTime() - _wibOffset);
    const todayUtcDate = _d;
    const todayWhere = and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${todayUtcDate}`, VALID_LOG_SQL)!;
    const todayStats = (await db.select({
      count: turnCountSql(todayWhere),
      tokens: turnTotalTokensSql(todayWhere),
      cost: sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    })
      .from(requestLogs).where(todayWhere))[0];
    // Cost scaled from the token split so it stays consistent with multiplied tokens.
    const todayBreakdown = applyTokenMultiplierRows(sanitizeRows((await db.execute(sql`
      SELECT model, COALESCE(SUM(sum_delta), 0) as "promptTokens", COALESCE(SUM(sum_c), 0) as "completionTokens"
      FROM (SELECT model, turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${key.id} AND created_at >= ${todayUtcDate} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY model, turn_id)
      GROUP BY model
    `)).rows as any[], ['promptTokens', 'completionTokens']));
    const todayCost = calculateBreakdownCosts(todayBreakdown as any).totalCost;
    const deviceCount = (await db.select({ count: sql<number>`count(*)` }).from(devices).where(eq(devices.apiKeyId, key.id)))[0];
    const totalWhere = and(eq(requestLogs.apiKeyId, key.id), VALID_LOG_SQL)!;
    const totalStats = (await db.select({
      count: turnCountSql(totalWhere),
      tokens: turnTotalTokensSql(totalWhere),
    })
      .from(requestLogs).where(totalWhere))[0];

    result.push({
      id: key.id, name: key.name, keyPrefix: key.keyPrefix, keyMasked: maskKey(key.key),
      discordUserId: key.discordUserId,
      discordUsername: key.discordUsername,
      provisionedBy: key.provisionedBy,
      isActive: key.isActive, maxDevices: key.maxDevices, devicePolicy: key.devicePolicy,
      ipPolicy: key.ipPolicy, idePolicy: key.idePolicy, 
      dailyTokenLimit: key.dailyTokenLimit || 0, monthlyTokenLimit: key.monthlyTokenLimit,
      dailyInputTokenLimit: key.dailyInputTokenLimit || 0, dailyOutputTokenLimit: key.dailyOutputTokenLimit || 0,
      rateLimit: key.rateLimit || 0, rateLimitWindow: key.rateLimitWindow || config?.globalRateLimitWindow || "1h",
      promptLimit: key.promptLimit || 0, promptLimitWindow: key.promptLimitWindow || config?.globalPromptLimitWindow || "1d",
      deviceCount: deviceCount?.count || 0, requestsToday: todayStats?.count || 0,
      tokensToday: todayStats?.tokens || 0, estimatedCostToday: todayCost,
      totalRequests: totalStats?.count || 0,
      totalTokens: totalStats?.tokens || 0, createdAt: key.createdAt,
    });
  }
  return result;
  }, 30_000)); // 30s TTL for keys list
});

keys.post("/keys", async (c) => {
  const { name, discordUserId, discordUsername, provisionedBy } = await c.req.json<{ name: string; discordUserId?: string; discordUsername?: string; provisionedBy?: string }>();
  if (!name || !name.trim()) return c.json({ error: "Name is required" }, 400);

  const key = generateApiKey();
  const [result] = await db.insert(apiKeys).values({
    name: name.trim(), key, keyPrefix: getKeyPrefix(key), keyHash: sha256(key),
    discordUserId: discordUserId || null,
    discordUsername: discordUsername || null,
    provisionedBy: provisionedBy || "dashboard",
  }).returning();

  return c.json({ id: result.id, name: result.name, key, keyPrefix: result.keyPrefix, isActive: result.isActive, createdAt: result.createdAt }, 201);
});

keys.get("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);
  const config = (await db.select().from(adminConfig))[0];

  // Period start timestamps
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);
  const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(wibMonthStartSql().replace(" ", "T") + "Z");

  // Analytics period filter: days=1 (today), 7 (week), 30 (month), 0/absent (all time)
  const days = parseInt(c.req.query("days") || "0");
  const analyticsSince: Date | null = days === 1
    ? todayStart
    : days > 0
      ? new Date(Date.now() - days * 86400000)
      : null;
  const analyticsDateFilter = analyticsSince ? sql`AND created_at >= ${analyticsSince}` : sql``;

  const buildPeriodStats = async (since?: Date) => {
    const whereClause = since
      ? and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${since}`, VALID_LOG_SQL)!
      : and(eq(requestLogs.apiKeyId, key.id), VALID_LOG_SQL)!;

    const s = (await db.select({
      turns:            turnCountSql(whereClause),
      tokens:           turnTotalTokensSql(whereClause),
      promptTokens:     turnPromptTokensSql(whereClause),
      completionTokens: turnCompletionTokensSql(whereClause),
      contextTokens:    sql<number>`0`,
      estimatedCost:    sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    }).from(requestLogs).where(whereClause))[0];

    const breakdown = applyTokenMultiplierRows(sanitizeRows((await db.execute(sql`
      SELECT model, COALESCE(SUM(sum_delta), 0) as "promptTokens", COALESCE(SUM(sum_c), 0) as "completionTokens"
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${key.id} ${since ? sql`AND created_at >= ${since}` : sql``} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND api_key_id = ${key.id} ${since ? sql`AND created_at >= ${since}` : sql``} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
      )
      GROUP BY model
    `)).rows as any[], ['promptTokens', 'completionTokens']));
    const costs = calculateBreakdownCosts(breakdown as any);
    return {
      requests:         s?.turns           || 0,
      tokens:           s?.tokens          || 0,
      promptTokens:     s?.promptTokens    || 0,
      completionTokens: s?.completionTokens|| 0,
      contextTokens:    s?.contextTokens   || 0,
      estimatedCost:    costs.totalCost,
      promptCost:       costs.promptCost,
      completionCost:   costs.completionCost,
    };
  };

  const [todayStats, weekStats, monthStats, allTimeStats] = await Promise.all([
    buildPeriodStats(todayStart),
    buildPeriodStats(weekStart),
    buildPeriodStats(monthStart),
    buildPeriodStats(),
  ]);

  const deviceCount = (await db.select({ count: sql<number>`count(*)` }).from(devices).where(eq(devices.apiKeyId, key.id)))[0];

  const { input: tmInput, output: tmOutput } = getTokenMultipliers();

  const topModels = sanitizeRows((await db.execute(sql`
    SELECT model, COUNT(*) as count, COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens, 0 as "estimatedCost"
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE api_key_id = ${key.id} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 ${analyticsDateFilter}
      GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
      UNION ALL
      SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE model LIKE 'auto (%)%' AND api_key_id = ${key.id} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 ${analyticsDateFilter}
      GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
    )
    GROUP BY model ORDER BY count DESC LIMIT 10
  `)).rows as any[], ['tokens']);

  const topModelsByTokens = sanitizeRows((await db.execute(sql`
    SELECT model, COUNT(*) as count, COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens, 0 as "estimatedCost"
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE api_key_id = ${key.id} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 ${analyticsDateFilter}
      GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
      UNION ALL
      SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
        turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
      FROM request_logs WHERE model LIKE 'auto (%)%' AND api_key_id = ${key.id} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 ${analyticsDateFilter}
      GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
    )
    GROUP BY model ORDER BY tokens DESC LIMIT 10
  `)).rows as any[], ['tokens']);

  const topDevices = sanitizeRows((await db.execute(sql`
    SELECT device_fingerprint as "deviceFingerprint", ip_address as "ipAddress",
      ide_detected as "ideDetected", os_detected as "osDetected", client_name as "clientName",
      COUNT(*) as requests, COUNT(DISTINCT session_id) as sessions,
      COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens, 0 as "estimatedCost",
      MAX(last_seen) as "lastSeen"
    FROM (SELECT device_fingerprint, ip_address, ide_detected, os_detected, client_name, session_id, turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c, MAX(created_at) as last_seen
      FROM request_logs WHERE api_key_id = ${key.id} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL ${analyticsDateFilter}
      GROUP BY device_fingerprint, ip_address, ide_detected, os_detected, client_name, session_id, turn_id)
    GROUP BY device_fingerprint, ip_address, ide_detected, os_detected, client_name ORDER BY tokens DESC LIMIT 20
  `)).rows as any[], ['requests', 'sessions', 'tokens']);

  const deviceSessionsWhere = analyticsSince
    ? and(eq(chatSessions.apiKeyId, key.id), sql`last_seen_at >= ${analyticsSince}`)
    : eq(chatSessions.apiKeyId, key.id);

  const deviceSessions = await db.select({
    sessionId: chatSessions.sessionId,
    sessionName: chatSessions.sessionName,
    deviceFingerprint: chatSessions.deviceFingerprint,
    ipAddress: chatSessions.ipAddress,
    ideDetected: chatSessions.ideDetected,
    provider: chatSessions.provider,
    model: chatSessions.model,
    requestCount: chatSessions.requestCount,
    totalTokens: chatSessions.totalTokens,
    estimatedCost: chatSessions.estimatedCost,
    lastContextTokens: chatSessions.lastContextTokens,
    contextFingerprint: chatSessions.contextFingerprint,
    firstSeenAt: chatSessions.firstSeenAt,
    lastSeenAt: chatSessions.lastSeenAt,
  }).from(chatSessions)
    .where(deviceSessionsWhere)
    .orderBy(sql`total_tokens DESC`)
    .limit(500);

  const devicePolicyCounts = (await db.select({
    deviceAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' AND fingerprint IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    deviceBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' AND fingerprint IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    ipAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' AND ip_address IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    ipBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' AND ip_address IS NOT NULL THEN 1 ELSE 0 END), 0)`,
  }).from(allowedDevices).where(eq(allowedDevices.apiKeyId, key.id)))[0];

  const idePolicyCounts = (await db.select({
    ideAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' THEN 1 ELSE 0 END), 0)`,
    ideBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' THEN 1 ELSE 0 END), 0)`,
  }).from(allowedIdes).where(eq(allowedIdes.apiKeyId, key.id)))[0];

  const devicePolicies = await db
    .select()
    .from(allowedDevices)
    .where(eq(allowedDevices.apiKeyId, key.id))
    .orderBy(sql`created_at DESC`)
    .limit(200);

  const idePolicies = await db
    .select()
    .from(allowedIdes)
    .where(eq(allowedIdes.apiKeyId, key.id))
    .orderBy(sql`created_at DESC`)
    .limit(200);

  return c.json({
    id: key.id, name: key.name, keyPrefix: key.keyPrefix, keyMasked: maskKey(key.key),
    discordUserId: key.discordUserId,
    discordUsername: key.discordUsername,
    provisionedBy: key.provisionedBy,
    isActive: key.isActive, maxDevices: key.maxDevices, devicePolicy: key.devicePolicy,
    ipPolicy: key.ipPolicy, idePolicy: key.idePolicy, 
    dailyTokenLimit: key.dailyTokenLimit || 0, monthlyTokenLimit: key.monthlyTokenLimit,
    dailyInputTokenLimit: key.dailyInputTokenLimit || 0, dailyOutputTokenLimit: key.dailyOutputTokenLimit || 0,
    rateLimit: key.rateLimit || 0, rateLimitWindow: key.rateLimitWindow || config?.globalRateLimitWindow || "1h",
    promptLimit: key.promptLimit || 0, promptLimitWindow: key.promptLimitWindow || config?.globalPromptLimitWindow || "1d",
    perModelPromptLimit: key.perModelPromptLimit || 0, perModelPromptLimitWindow: key.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "1d",
    createdAt: key.createdAt, updatedAt: key.updatedAt,
    stats: {
      today:   { ...todayStats },
      week:    { ...weekStats },
      month:   { ...monthStats },
      allTime: { ...allTimeStats, contextTokens: allTimeStats.contextTokens },
      deviceCount: deviceCount?.count || 0,
      topModels,
    },
    policyStats: {
      deviceAllowCount: devicePolicyCounts?.deviceAllowCount || 0,
      deviceBlockCount: devicePolicyCounts?.deviceBlockCount || 0,
      ipAllowCount: devicePolicyCounts?.ipAllowCount || 0,
      ipBlockCount: devicePolicyCounts?.ipBlockCount || 0,
      ideAllowCount: idePolicyCounts?.ideAllowCount || 0,
      ideBlockCount: idePolicyCounts?.ideBlockCount || 0,
    },
    policyEntries: {
      devices: devicePolicies,
      ides: idePolicies,
    },
    analytics: {
      topModelsByTokens,
      topDevices,
      deviceSessions,
    },
  });
});

keys.put("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json<any>();
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.maxDevices !== undefined) updates.maxDevices = body.maxDevices;
  if (body.devicePolicy !== undefined) updates.devicePolicy = body.devicePolicy;
  if (body.ipPolicy !== undefined) updates.ipPolicy = body.ipPolicy;
  if (body.idePolicy !== undefined) updates.idePolicy = body.idePolicy;
  if (body.dailyTokenLimit !== undefined) updates.dailyTokenLimit = body.dailyTokenLimit;
  if (body.monthlyTokenLimit !== undefined) updates.monthlyTokenLimit = body.monthlyTokenLimit;
  if (body.dailyInputTokenLimit !== undefined) updates.dailyInputTokenLimit = body.dailyInputTokenLimit;
  if (body.dailyOutputTokenLimit !== undefined) updates.dailyOutputTokenLimit = body.dailyOutputTokenLimit;
  if (body.rateLimit !== undefined) updates.rateLimit = body.rateLimit;
  if (body.rateLimitWindow !== undefined) updates.rateLimitWindow = body.rateLimitWindow || null;
  if (body.promptLimit !== undefined) updates.promptLimit = body.promptLimit;
  if (body.promptLimitWindow !== undefined) updates.promptLimitWindow = body.promptLimitWindow || null;
  if (body.perModelPromptLimit !== undefined) updates.perModelPromptLimit = body.perModelPromptLimit;
  if (body.perModelPromptLimitWindow !== undefined) updates.perModelPromptLimitWindow = body.perModelPromptLimitWindow || null;
  if (body.dailyInputTokenLimit !== undefined) updates.dailyInputTokenLimit = body.dailyInputTokenLimit;
  if (body.dailyOutputTokenLimit !== undefined) updates.dailyOutputTokenLimit = body.dailyOutputTokenLimit;

  await db.update(apiKeys).set(updates).where(eq(apiKeys.id, id));
  apiKeyCache.clear(); // invalidate all cached keys since we matched by id, not key string
  statsCache.invalidate("keys-list"); // invalidate keys list cache
  return c.json({ success: true, message: "API key updated" });
});

keys.delete("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  apiKeyCache.clear();
  statsCache.invalidate("keys-list");
  return c.json({ success: true, message: "API key deleted" });
});

keys.post("/keys/:id/rotate", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const newKey = generateApiKey();
  await db.update(apiKeys).set({
    key: newKey, keyPrefix: getKeyPrefix(newKey), keyHash: sha256(newKey),
    updatedAt: new Date(),
  }).where(eq(apiKeys.id, id));

  apiKeyCache.clear(); // invalidate cached keys after rotation
  statsCache.invalidate("keys-list");
  return c.json({ success: true, key: newKey, keyPrefix: getKeyPrefix(newKey), message: "API key rotated." });
});

keys.get("/keys/:id/devices", async (c) => {
  const id = parseInt(c.req.param("id"));
  const allDevices = await db.select().from(devices).where(eq(devices.apiKeyId, id)).orderBy(desc(devices.lastSeen));
  return c.json(allDevices);
});

keys.post("/keys/:id/devices/:fingerprint/block", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  await db.update(devices).set({ isBlocked: true }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));

  const existing = await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "block")));
  const blockExisting = existing[0];
  if (!blockExisting) {
    await db.insert(allowedDevices).values({ apiKeyId: keyId, fingerprint, listType: "block", label: "Blocked via dashboard" });
  }
  return c.json({ success: true, message: "Device blocked" });
});

keys.post("/keys/:id/devices/:fingerprint/allow", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  await db.update(devices).set({ isBlocked: false }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));
  await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "block")));

  const existing = await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "allow")));
  const allowExisting = existing[0];
  if (!allowExisting) {
    await db.insert(allowedDevices).values({ apiKeyId: keyId, fingerprint, listType: "allow", label: "Allowed via dashboard" });
  }
  return c.json({ success: true, message: "Device allowed" });
});

keys.delete("/keys/:id/devices/:fingerprint", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");
  await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint)));
  await db.update(devices).set({ isBlocked: false }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));
  return c.json({ success: true, message: "Device removed from list" });
});

keys.post("/keys/:id/policies/device", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{
    targetType?: "fingerprint" | "ip";
    value?: string;
    listType?: "allow" | "block";
    label?: string;
  }>();

  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const targetType = body.targetType === "ip" ? "ip" : "fingerprint";
  const listType = body.listType === "block" ? "block" : "allow";
  const value = String(body.value || "").trim();
  const label = String(body.label || "").trim();

  if (!value) {
    return c.json({ error: "Rule value is required" }, 400);
  }

  const where = targetType === "ip"
    ? and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.ipAddress, value), eq(allowedDevices.listType, listType))
    : and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, value), eq(allowedDevices.listType, listType));

  const existing = (await db.select().from(allowedDevices).where(where))[0];
  if (existing) {
    return c.json({ success: true, message: "Rule already exists", id: existing.id });
  }

  const [inserted] = await db.insert(allowedDevices).values({
    apiKeyId: keyId,
    fingerprint: targetType === "fingerprint" ? value : null,
    ipAddress: targetType === "ip" ? value : null,
    listType,
    label: label || `${listType === "block" ? "Blocked" : "Allowed"} via dashboard`,
  }).returning();

  if (targetType === "fingerprint") {
    if (listType === "block") {
      await db.update(devices)
        .set({ isBlocked: true })
        .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, value)));
    } else {
      await db.update(devices)
        .set({ isBlocked: false })
        .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, value)));
    }
  }

  return c.json({ success: true, id: inserted.id, message: "Rule added" }, 201);
});

keys.delete("/keys/:id/policies/device/:ruleId", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const ruleId = parseInt(c.req.param("ruleId"));

  const existing = (await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.id, ruleId), eq(allowedDevices.apiKeyId, keyId))))[0];

  if (!existing) return c.json({ error: "Rule not found" }, 404);

  await db.delete(allowedDevices)
    .where(and(eq(allowedDevices.id, ruleId), eq(allowedDevices.apiKeyId, keyId)));

  if (existing.fingerprint && existing.listType === "block") {
    await db.update(devices)
      .set({ isBlocked: false })
      .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, existing.fingerprint)));
  }

  return c.json({ success: true, message: "Rule removed" });
});

keys.post("/keys/:id/policies/ide", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{ ideName?: string; listType?: "allow" | "block" }>();
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const ideName = normalizeIdeName(body.ideName || "");
  const listType = body.listType === "block" ? "block" : "allow";

  if (!ideName || ideName === "unknown") {
    return c.json({ error: "Valid IDE name is required" }, 400);
  }

  const existing = (await db.select().from(allowedIdes)
    .where(and(eq(allowedIdes.apiKeyId, keyId), eq(allowedIdes.ideName, ideName), eq(allowedIdes.listType, listType))))[0];

  if (existing) {
    return c.json({ success: true, message: "IDE rule already exists", id: existing.id });
  }

  const [inserted] = await db.insert(allowedIdes).values({ apiKeyId: keyId, ideName, listType }).returning();
  return c.json({ success: true, id: inserted.id, message: "IDE rule added" }, 201);
});

keys.delete("/keys/:id/policies/ide/:ruleId", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const ruleId = parseInt(c.req.param("ruleId"));

  const existing = (await db.select().from(allowedIdes)
    .where(and(eq(allowedIdes.id, ruleId), eq(allowedIdes.apiKeyId, keyId))))[0];

  if (!existing) return c.json({ error: "IDE rule not found" }, 404);

  await db.delete(allowedIdes)
    .where(and(eq(allowedIdes.id, ruleId), eq(allowedIdes.apiKeyId, keyId)));

  return c.json({ success: true, message: "IDE rule removed" });
});

// ─── Per-Key Model Limits CRUD ─────────────────────────────────────────────────

keys.get("/keys/:id/model-limits", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const rows = await db.select().from(modelLimits)
    .where(and(eq(modelLimits.scope, "key"), eq(modelLimits.scopeId, keyId)));
  const data = await enrichModelLimitsWithCatalog(rows);
  return c.json({ data });
});

keys.put("/keys/:id/model-limits", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{ model: string; promptLimit?: number; dailyTokenLimit?: number; monthlyTokenLimit?: number; dailyInputTokenLimit?: number; dailyOutputTokenLimit?: number; isPattern?: boolean }>();
  if (!body.model || body.model.trim() === "") return c.json({ error: "model is required" }, 400);
  const modelName = body.model.trim();
  const isPattern = !!body.isPattern;
  const limit = Math.max(0, body.promptLimit || 0);
  const dailyTokenLimit = Math.max(0, body.dailyTokenLimit || 0);
  const monthlyTokenLimit = Math.max(0, body.monthlyTokenLimit || 0);
  const dailyInputTokenLimit = Math.max(0, body.dailyInputTokenLimit || 0);
  const dailyOutputTokenLimit = Math.max(0, body.dailyOutputTokenLimit || 0);

  // Upsert (key + model + isPattern is the unique triple). Use raw SQL for
  // the DELETE to avoid a Drizzle issue with the boolean is_pattern column.
  const { pool } = await import("../../db/index.js");
  await pool.query(
    `DELETE FROM model_limits WHERE scope = $1 AND scope_id = $2 AND model = $3 AND is_pattern = $4`,
    ["key", keyId, modelName, isPattern]
  );

  if (limit > 0 || dailyTokenLimit > 0 || monthlyTokenLimit > 0 || dailyInputTokenLimit > 0 || dailyOutputTokenLimit > 0) {
    await db.insert(modelLimits).values({
      scope: "key", scopeId: keyId, model: modelName, isPattern,
      promptLimit: limit,
      dailyTokenLimit,
      monthlyTokenLimit,
      dailyInputTokenLimit,
      dailyOutputTokenLimit
    });
  }

  return c.json({ success: true, model: modelName, isPattern, promptLimit: limit, dailyTokenLimit, monthlyTokenLimit, dailyInputTokenLimit, dailyOutputTokenLimit });
});

// GET /keys/:id/model-catalog/match?pattern=X
keys.get("/keys/:id/model-catalog/match", async (c) => {
  const pattern = (c.req.query("pattern") || "").toLowerCase().trim();
  try {
    const catalog = await getModelCatalogResponse();
    const all: Array<{ id: string }> = (catalog as any)?.data || [];
    const matched = pattern
      ? all.filter(m => (m.id || "").toLowerCase().includes(pattern))
      : all;
    return c.json({ data: matched.map(m => m.id), total: matched.length, totalAll: all.length });
  } catch (err: any) {
    return c.json({ data: [], total: 0, totalAll: 0, error: err?.message || "catalog error" }, 200);
  }
});

keys.delete("/keys/:id/model-limits/:model", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const model = decodeURIComponent(c.req.param("model"));
  await db.delete(modelLimits).where(and(
    eq(modelLimits.scope, "key"),
    eq(modelLimits.scopeId, keyId),
    eq(modelLimits.model, model),
  ));
  return c.json({ success: true, message: `Model limit for "${model}" removed` });
});

export default keys;
