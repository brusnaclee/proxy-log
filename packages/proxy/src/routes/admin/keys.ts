import { Hono } from "hono";
import { db } from "../../db/index.js";
import { apiKeys, requestLogs, devices, allowedDevices, allowedIdes, chatSessions, adminConfig, modelLimits } from "../../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { generateApiKey, getKeyPrefix, sha256, maskKey } from "../../utils/crypto.js";
import { normalizeIdeName } from "../../utils/detect-ide.js";
import { getModelRates } from "../../utils/cost-calculator.js";

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
  const allKeys = await db.select().from(apiKeys).all();
  const config = await db.select().from(adminConfig).get();
  const result = [];

  for (const key of allKeys) {
    const _d = new Date(); _d.setHours(0, 0, 0, 0);
    const todayUtcStr = _d.toISOString().replace('T', ' ').substring(0, 19);
    const todayStats = await db.select({ count: sql<number>`count(*)`, tokens: sql<number>`COALESCE(SUM(total_tokens), 0)` })
      .from(requestLogs).where(and(
        eq(requestLogs.apiKeyId, key.id), 
        sql`created_at >= ${todayUtcStr}`,
        sql`is_counted_request IS NOT 0`
      )).get();
    const deviceCount = await db.select({ count: sql<number>`count(*)` }).from(devices).where(eq(devices.apiKeyId, key.id)).get();
    const totalStats = await db.select({ count: sql<number>`count(*)`, tokens: sql<number>`COALESCE(SUM(total_tokens), 0)` })
      .from(requestLogs).where(and(
        eq(requestLogs.apiKeyId, key.id),
        sql`is_counted_request IS NOT 0`
      )).get();

    result.push({
      id: key.id, name: key.name, keyPrefix: key.keyPrefix, keyMasked: maskKey(key.key),
      discordUserId: key.discordUserId,
      discordUsername: key.discordUsername,
      provisionedBy: key.provisionedBy,
      isActive: key.isActive, maxDevices: key.maxDevices, devicePolicy: key.devicePolicy,
      ipPolicy: key.ipPolicy, idePolicy: key.idePolicy, monthlyTokenLimit: key.monthlyTokenLimit,
      rateLimit: key.rateLimit || 0, rateLimitWindow: key.rateLimitWindow || config?.globalRateLimitWindow || "1h",
      promptLimit: key.promptLimit || 0, promptLimitWindow: key.promptLimitWindow || config?.globalPromptLimitWindow || "1d",
      deviceCount: deviceCount?.count || 0, requestsToday: todayStats?.count || 0,
      tokensToday: todayStats?.tokens || 0, totalRequests: totalStats?.count || 0,
      totalTokens: totalStats?.tokens || 0, createdAt: key.createdAt,
    });
  }
  return c.json(result);
});

keys.post("/keys", async (c) => {
  const { name, discordUserId, discordUsername, provisionedBy } = await c.req.json<{ name: string; discordUserId?: string; discordUsername?: string; provisionedBy?: string }>();
  if (!name || !name.trim()) return c.json({ error: "Name is required" }, 400);

  const key = generateApiKey();
  const result = await db.insert(apiKeys).values({
    name: name.trim(), key, keyPrefix: getKeyPrefix(key), keyHash: sha256(key),
    discordUserId: discordUserId || null,
    discordUsername: discordUsername || null,
    provisionedBy: provisionedBy || "dashboard",
  }).returning().get();

  return c.json({ id: result.id, name: result.name, key, keyPrefix: result.keyPrefix, isActive: result.isActive, createdAt: result.createdAt }, 201);
});

keys.get("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  if (!key) return c.json({ error: "API key not found" }, 404);
  const config = await db.select().from(adminConfig).get();

  // Period start timestamps
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now); monthStart.setDate(now.getDate() - 30);

  const toSqlDate = (d: Date) => d.toISOString().replace('T', ' ').substring(0, 19);

  const buildPeriodStats = async (since?: string) => {
    const where = since
      ? and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${since}`, sql`is_counted_request IS NOT 0`)
      : and(eq(requestLogs.apiKeyId, key.id), sql`is_counted_request IS NOT 0`);
    const s = await db.select({
      count:           sql<number>`count(*)`,
      tokens:          sql<number>`COALESCE(SUM(total_tokens), 0)`,
      promptTokens:    sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
      completionTokens:sql<number>`COALESCE(SUM(completion_tokens), 0)`,
      contextTokens:   sql<number>`COALESCE(SUM(estimated_context_length), 0)`,
      estimatedCost:   sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    }).from(requestLogs).where(where).get();
    const breakdown = await db.select({
      model: requestLogs.model,
      promptTokens:    sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
      completionTokens:sql<number>`COALESCE(SUM(completion_tokens), 0)`,
    }).from(requestLogs).where(where).groupBy(requestLogs.model).all();
    const costs = calculateBreakdownCosts(breakdown);
    return {
      requests:        s?.count           || 0,
      tokens:          s?.tokens          || 0,
      promptTokens:    s?.promptTokens    || 0,
      completionTokens:s?.completionTokens|| 0,
      contextTokens:   s?.contextTokens   || 0,
      estimatedCost:   s?.estimatedCost   || 0,
      promptCost:      costs.promptCost,
      completionCost:  costs.completionCost,
    };
  };

  const [todayStats, weekStats, monthStats, allTimeStats] = await Promise.all([
    buildPeriodStats(toSqlDate(todayStart)),
    buildPeriodStats(toSqlDate(weekStart)),
    buildPeriodStats(toSqlDate(monthStart)),
    buildPeriodStats(),
  ]);

  const deviceCount = await db.select({ count: sql<number>`count(*)` }).from(devices).where(eq(devices.apiKeyId, key.id)).get();

  const topModels = await db.select({
    model: requestLogs.model, count: sql<number>`count(*)`, tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    estimatedCost: sql<number>`COALESCE(SUM(estimated_cost), 0)`,
  }).from(requestLogs).where(eq(requestLogs.apiKeyId, key.id)).groupBy(requestLogs.model).orderBy(sql`count(*) DESC`).limit(10).all();

  const topModelsByTokens = await db.select({
    model: requestLogs.model,
    requests: sql<number>`count(*)`,
    tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    estimatedCost: sql<number>`COALESCE(SUM(estimated_cost), 0)`,
  }).from(requestLogs)
    .where(eq(requestLogs.apiKeyId, key.id))
    .groupBy(requestLogs.model)
    .orderBy(sql`COALESCE(SUM(total_tokens), 0) DESC`)
    .limit(10)
    .all();

  const topDevices = await db.select({
    deviceFingerprint: requestLogs.deviceFingerprint,
    ipAddress: sql<string>`MAX(ip_address)`,
    ideDetected: sql<string>`MAX(ide_detected)`,
    osDetected: sql<string>`MAX(os_detected)`,
    clientName: sql<string>`MAX(client_name)`,
    requests: sql<number>`count(*)`,
    sessions: sql<number>`COUNT(DISTINCT session_id)`,
    tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    estimatedCost: sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    lastSeen: sql<string>`MAX(created_at)`,
  }).from(requestLogs)
    .where(eq(requestLogs.apiKeyId, key.id))
    .groupBy(requestLogs.deviceFingerprint)
    .orderBy(sql`COALESCE(SUM(total_tokens), 0) DESC`)
    .limit(20)
    .all();

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
    .where(eq(chatSessions.apiKeyId, key.id))
    .orderBy(sql`total_tokens DESC`)
    .limit(500)
    .all();

  const devicePolicyCounts = await db.select({
    deviceAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' AND fingerprint IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    deviceBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' AND fingerprint IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    ipAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' AND ip_address IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    ipBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' AND ip_address IS NOT NULL THEN 1 ELSE 0 END), 0)`,
  }).from(allowedDevices).where(eq(allowedDevices.apiKeyId, key.id)).get();

  const idePolicyCounts = await db.select({
    ideAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' THEN 1 ELSE 0 END), 0)`,
    ideBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' THEN 1 ELSE 0 END), 0)`,
  }).from(allowedIdes).where(eq(allowedIdes.apiKeyId, key.id)).get();

  const devicePolicies = await db
    .select()
    .from(allowedDevices)
    .where(eq(allowedDevices.apiKeyId, key.id))
    .orderBy(sql`created_at DESC`)
    .limit(200)
    .all();

  const idePolicies = await db
    .select()
    .from(allowedIdes)
    .where(eq(allowedIdes.apiKeyId, key.id))
    .orderBy(sql`created_at DESC`)
    .limit(200)
    .all();

  return c.json({
    id: key.id, name: key.name, keyPrefix: key.keyPrefix, keyMasked: maskKey(key.key),
    discordUserId: key.discordUserId,
    discordUsername: key.discordUsername,
    provisionedBy: key.provisionedBy,
    isActive: key.isActive, maxDevices: key.maxDevices, devicePolicy: key.devicePolicy,
    ipPolicy: key.ipPolicy, idePolicy: key.idePolicy, monthlyTokenLimit: key.monthlyTokenLimit,
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
  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  if (!key) return c.json({ error: "API key not found" }, 404);

  const updates: Record<string, any> = { updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) };
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.maxDevices !== undefined) updates.maxDevices = body.maxDevices;
  if (body.devicePolicy !== undefined) updates.devicePolicy = body.devicePolicy;
  if (body.ipPolicy !== undefined) updates.ipPolicy = body.ipPolicy;
  if (body.idePolicy !== undefined) updates.idePolicy = body.idePolicy;
  if (body.monthlyTokenLimit !== undefined) updates.monthlyTokenLimit = body.monthlyTokenLimit;
  if (body.rateLimit !== undefined) updates.rateLimit = body.rateLimit;
  if (body.rateLimitWindow !== undefined) updates.rateLimitWindow = body.rateLimitWindow || null;
  if (body.promptLimit !== undefined) updates.promptLimit = body.promptLimit;
  if (body.promptLimitWindow !== undefined) updates.promptLimitWindow = body.promptLimitWindow || null;
  if (body.perModelPromptLimit !== undefined) updates.perModelPromptLimit = body.perModelPromptLimit;
  if (body.perModelPromptLimitWindow !== undefined) updates.perModelPromptLimitWindow = body.perModelPromptLimitWindow || null;

  await db.update(apiKeys).set(updates).where(eq(apiKeys.id, id)).run();
  return c.json({ success: true, message: "API key updated" });
});

keys.delete("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  if (!key) return c.json({ error: "API key not found" }, 404);
  await db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
  return c.json({ success: true, message: "API key deleted" });
});

keys.post("/keys/:id/rotate", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  if (!key) return c.json({ error: "API key not found" }, 404);

  const newKey = generateApiKey();
  await db.update(apiKeys).set({
    key: newKey, keyPrefix: getKeyPrefix(newKey), keyHash: sha256(newKey),
    updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
  }).where(eq(apiKeys.id, id)).run();

  return c.json({ success: true, key: newKey, keyPrefix: getKeyPrefix(newKey), message: "API key rotated." });
});

keys.get("/keys/:id/devices", async (c) => {
  const id = parseInt(c.req.param("id"));
  const allDevices = await db.select().from(devices).where(eq(devices.apiKeyId, id)).orderBy(sql`last_seen DESC`).all();
  return c.json(allDevices);
});

keys.post("/keys/:id/devices/:fingerprint/block", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  await db.update(devices).set({ isBlocked: true }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint))).run();

  const existing = await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "block"))).get();
  if (!existing) {
    await db.insert(allowedDevices).values({ apiKeyId: keyId, fingerprint, listType: "block", label: "Blocked via dashboard" }).run();
  }
  return c.json({ success: true, message: "Device blocked" });
});

keys.post("/keys/:id/devices/:fingerprint/allow", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  await db.update(devices).set({ isBlocked: false }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint))).run();
  await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "block"))).run();

  const existing = await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "allow"))).get();
  if (!existing) {
    await db.insert(allowedDevices).values({ apiKeyId: keyId, fingerprint, listType: "allow", label: "Allowed via dashboard" }).run();
  }
  return c.json({ success: true, message: "Device allowed" });
});

keys.delete("/keys/:id/devices/:fingerprint", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");
  await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint))).run();
  await db.update(devices).set({ isBlocked: false }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint))).run();
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

  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get();
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

  const existing = await db.select().from(allowedDevices).where(where).get();
  if (existing) {
    return c.json({ success: true, message: "Rule already exists", id: existing.id });
  }

  const inserted = await db.insert(allowedDevices).values({
    apiKeyId: keyId,
    fingerprint: targetType === "fingerprint" ? value : null,
    ipAddress: targetType === "ip" ? value : null,
    listType,
    label: label || `${listType === "block" ? "Blocked" : "Allowed"} via dashboard`,
  }).returning().get();

  if (targetType === "fingerprint") {
    if (listType === "block") {
      await db.update(devices)
        .set({ isBlocked: true })
        .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, value)))
        .run();
    } else {
      await db.update(devices)
        .set({ isBlocked: false })
        .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, value)))
        .run();
    }
  }

  return c.json({ success: true, id: inserted.id, message: "Rule added" }, 201);
});

keys.delete("/keys/:id/policies/device/:ruleId", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const ruleId = parseInt(c.req.param("ruleId"));

  const existing = await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.id, ruleId), eq(allowedDevices.apiKeyId, keyId)))
    .get();

  if (!existing) return c.json({ error: "Rule not found" }, 404);

  await db.delete(allowedDevices)
    .where(and(eq(allowedDevices.id, ruleId), eq(allowedDevices.apiKeyId, keyId)))
    .run();

  if (existing.fingerprint && existing.listType === "block") {
    await db.update(devices)
      .set({ isBlocked: false })
      .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, existing.fingerprint)))
      .run();
  }

  return c.json({ success: true, message: "Rule removed" });
});

keys.post("/keys/:id/policies/ide", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{ ideName?: string; listType?: "allow" | "block" }>();
  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get();
  if (!key) return c.json({ error: "API key not found" }, 404);

  const ideName = normalizeIdeName(body.ideName || "");
  const listType = body.listType === "block" ? "block" : "allow";

  if (!ideName || ideName === "unknown") {
    return c.json({ error: "Valid IDE name is required" }, 400);
  }

  const existing = await db.select().from(allowedIdes)
    .where(and(eq(allowedIdes.apiKeyId, keyId), eq(allowedIdes.ideName, ideName), eq(allowedIdes.listType, listType)))
    .get();

  if (existing) {
    return c.json({ success: true, message: "IDE rule already exists", id: existing.id });
  }

  const inserted = await db.insert(allowedIdes).values({ apiKeyId: keyId, ideName, listType }).returning().get();
  return c.json({ success: true, id: inserted.id, message: "IDE rule added" }, 201);
});

keys.delete("/keys/:id/policies/ide/:ruleId", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const ruleId = parseInt(c.req.param("ruleId"));

  const existing = await db.select().from(allowedIdes)
    .where(and(eq(allowedIdes.id, ruleId), eq(allowedIdes.apiKeyId, keyId)))
    .get();

  if (!existing) return c.json({ error: "IDE rule not found" }, 404);

  await db.delete(allowedIdes)
    .where(and(eq(allowedIdes.id, ruleId), eq(allowedIdes.apiKeyId, keyId)))
    .run();

  return c.json({ success: true, message: "IDE rule removed" });
});

// ─── Per-Key Model Limits CRUD ─────────────────────────────────────────────────

keys.get("/keys/:id/model-limits", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const rows = await db.select().from(modelLimits)
    .where(and(eq(modelLimits.scope, "key"), eq(modelLimits.scopeId, keyId)))
    .all();
  return c.json({ data: rows });
});

keys.put("/keys/:id/model-limits", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{ model: string; promptLimit: number }>();
  if (!body.model || body.model.trim() === "") return c.json({ error: "model is required" }, 400);
  const modelName = body.model.trim();
  const limit = Math.max(0, body.promptLimit || 0);

  // Upsert
  await db.delete(modelLimits).where(and(
    eq(modelLimits.scope, "key"),
    eq(modelLimits.scopeId, keyId),
    eq(modelLimits.model, modelName),
  )).run();

  if (limit > 0) {
    await db.insert(modelLimits).values({
      scope: "key", scopeId: keyId, model: modelName, promptLimit: limit,
    }).run();
  }

  return c.json({ success: true, model: modelName, promptLimit: limit });
});

keys.delete("/keys/:id/model-limits/:model", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const model = decodeURIComponent(c.req.param("model"));
  await db.delete(modelLimits).where(and(
    eq(modelLimits.scope, "key"),
    eq(modelLimits.scopeId, keyId),
    eq(modelLimits.model, model),
  )).run();
  return c.json({ success: true, message: `Model limit for "${model}" removed` });
});

export default keys;
