import { Hono } from "hono";
import { db } from "../../db/index.js";
import { apiKeys, requestLogs, devices, allowedDevices, allowedIdes, chatSessions, userPortalSettings } from "../../db/schema.js";
import { eq, sql, and, desc } from "drizzle-orm";
import { generateApiKey, getKeyPrefix, sha256, maskKey } from "../../utils/crypto.js";
import { createPortalSession, destroyPortalSession, getPortalDiscordUserId, isPortalAuthenticated } from "../../middleware/portal-session.js";
import { resolvePeriodRange, chartDaysForPeriod, type PeriodKey } from "../../utils/counting.js";
import { turnCountSql, turnPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql, sanitizeRows } from "../../utils/counting.js";
import { getTokenMultipliers } from "../../utils/token-multiplier.js";
import { getModelRates } from "../../utils/cost-calculator.js";

const portal = new Hono();

function userApiKeyIds(discordUserId: string) {
  return sql`SELECT id FROM api_keys WHERE discord_user_id = ${discordUserId}`;
}

function userWhere(discordUserId: string) {
  return sql`api_key_id IN (${userApiKeyIds(discordUserId)})`;
}

function periodWhere(discordUserId: string, period: PeriodKey) {
  const range = resolvePeriodRange(period);
  return and(
    userWhere(discordUserId),
    sql`created_at >= ${range.start}`,
    range.end ? sql`created_at <= ${range.end}` : sql`1=1`,
    sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`
  );
}

function periodWhereNoTurn(discordUserId: string, period: PeriodKey) {
  const range = resolvePeriodRange(period);
  return and(
    userWhere(discordUserId),
    sql`created_at >= ${range.start}`,
    range.end ? sql`created_at <= ${range.end}` : sql`1=1`
  );
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

portal.post("/auth/login", async (c) => {
  const { apiKey } = await c.req.json<{ apiKey: string }>();
  if (!apiKey) return c.json({ error: "API key required" }, 400);

  let key = (await db.select().from(apiKeys).where(eq(apiKeys.key, apiKey)))[0];
  if (!key) {
    const keyHash = sha256(apiKey);
    key = (await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)))[0];
  }
  if (!key) return c.json({ error: "Invalid API key" }, 401);
  if (!key.isActive) return c.json({ error: "API key is not active" }, 403);
  if (!key.discordUserId) return c.json({ error: "API key not linked to a Discord user" }, 403);

  const discordUserId = key.discordUserId;
  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];

  if (settings?.passwordHash) {
    return c.json({ requiresPassword: true, discordUserId });
  }

  createPortalSession(c, discordUserId);
  return c.json({ success: true, autoLogin: true, discordUserId });
});

portal.post("/auth/verify-password", async (c) => {
  const { discordUserId, password } = await c.req.json<{ discordUserId: string; password: string }>();
  if (!discordUserId || !password) return c.json({ error: "Missing fields" }, 400);

  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];
  if (!settings?.passwordHash) return c.json({ error: "No password set" }, 400);

  const { verify } = await import("@node-rs/argon2");
  const isValid = await verify(settings.passwordHash, password);
  if (!isValid) return c.json({ error: "Invalid password" }, 401);

  createPortalSession(c, discordUserId);
  return c.json({ success: true });
});

portal.post("/auth/logout", (c) => {
  destroyPortalSession(c);
  return c.json({ success: true });
});

// ─── Auth middleware ────────────────────────────────────────────────────────────
portal.use("/*", async (c, next) => {
  const path = c.req.path;
  if (
    path === "/auth/login" ||
    path === "/auth/verify-password"
  ) {
    return next();
  }
  if (!isPortalAuthenticated(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ─── Me ─────────────────────────────────────────────────────────────────────────

portal.get("/me", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const userKeys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];
  const firstKey = userKeys[0];

  return c.json({
    discordUserId,
    discordUsername: firstKey?.discordUsername || null,
    hasPassword: !!settings?.passwordHash,
    keyCount: userKeys.length,
    keys: userKeys.map(k => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      isActive: k.isActive,
      isTrial: k.isTrial || false,
      createdAt: k.createdAt,
    })),
    limits: {
      maxDevices: firstKey?.maxDevices || 0,
      dailyTokenLimit: firstKey?.dailyTokenLimit || 0,
      monthlyTokenLimit: firstKey?.monthlyTokenLimit || 0,
      dailyInputTokenLimit: firstKey?.dailyInputTokenLimit || 0,
      dailyOutputTokenLimit: firstKey?.dailyOutputTokenLimit || 0,
      rateLimit: firstKey?.rateLimit || 0,
      rateLimitWindow: firstKey?.rateLimitWindow || "1h",
      promptLimit: firstKey?.promptLimit || 0,
      promptLimitWindow: firstKey?.promptLimitWindow || "1d",
    },
  });
});

// ─── Stats ─────────────────────────────────────────────────────────────────────

portal.get("/stats/overview", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const pw = periodWhere(discordUserId, period);

  const stats = (await db.select({
    requests: turnCountSql(pw),
    tokens: turnTotalTokensSql(pw),
    promptTokens: turnPromptTokensSql(pw),
    completionTokens: turnCompletionTokensSql(pw),
  }).from(requestLogs).where(pw))[0];

  const sessionWhere = userWhere(discordUserId);
  const sessionCount = (await db.select({ count: sql<number>`count(*)` }).from(chatSessions).where(sessionWhere))[0];

  const toolCount = (await db.select({ count: sql<number>`COALESCE(SUM(tool_count), 0)` }).from(requestLogs).where(pw))[0];

  // Cost breakdown by model
  const range = resolvePeriodRange(period);
  const breakdownRows = sanitizeRows((await db.execute(sql`
    SELECT model,
      COALESCE(SUM(sum_delta), 0) as "promptTokens",
      COALESCE(SUM(sum_c), 0) as "completionTokens"
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model, turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
        AND created_at >= ${range.start}
        ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY model, turn_id
    ) sub
    GROUP BY model
  `)).rows as any[], ["promptTokens", "completionTokens"]);

  const { input, output } = getTokenMultipliers();
  let promptCost = 0;
  let completionCost = 0;
  for (const row of breakdownRows) {
    const rates = getModelRates(row.model || "");
    promptCost += Math.round(row.promptTokens * input * rates.prompt);
    completionCost += Math.round(row.completionTokens * output * rates.completion);
  }

  return c.json({
    requests: stats?.requests || 0,
    tokens: stats?.tokens || 0,
    promptTokens: Math.round((stats?.promptTokens || 0) * input),
    completionTokens: Math.round((stats?.completionTokens || 0) * output),
    sessions: Number(sessionCount?.count) || 0,
    toolCalls: Number(toolCount?.count) || 0,
    cost: { prompt: promptCost, completion: completionCost, total: promptCost + completionCost },
  });
});

portal.get("/stats/timeseries", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "7d") as PeriodKey;
  const range = resolvePeriodRange(period);
  const days = chartDaysForPeriod(period);
  const groupExpr = days <= 1
    ? sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:00')`
    : sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

  const rows = sanitizeRows((await db.execute(sql`
    SELECT period_group as period,
      COUNT(*) as requests,
      COALESCE(SUM(sum_delta + sum_c), 0) as tokens,
      COALESCE(SUM(sum_delta), 0) as "promptTokens",
      COALESCE(SUM(sum_c), 0) as "completionTokens"
    FROM (
      SELECT ${groupExpr} as period_group, turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
        AND created_at >= ${range.start}
        ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY ${groupExpr}, turn_id
    ) sub
    GROUP BY period_group
    ORDER BY period_group
  `)).rows as any[], ["requests", "tokens", "promptTokens", "completionTokens"]);

  return c.json(rows);
});

portal.get("/stats/by-model", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const range = resolvePeriodRange(period);

  const rows = sanitizeRows((await db.execute(sql`
    SELECT model, COUNT(*) as requests,
      COALESCE(SUM(sum_delta), 0) as "promptTokens",
      COALESCE(SUM(sum_c), 0) as "completionTokens"
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model, turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
        AND created_at >= ${range.start}
        ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY model, turn_id
    ) sub
    GROUP BY model
    ORDER BY requests DESC
    LIMIT 20
  `)).rows as any[], ["requests", "promptTokens", "completionTokens"]);

  const { input, output } = getTokenMultipliers();
  return c.json(rows.map((r: any) => ({
    ...r,
    promptTokens: Math.round(r.promptTokens * input),
    completionTokens: Math.round(r.completionTokens * output),
    tokens: Math.round(r.promptTokens * input + r.completionTokens * output),
  })));
});

portal.get("/stats/by-ide", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const range = resolvePeriodRange(period);

  const rows = sanitizeRows((await db.execute(sql`
    SELECT ide_detected as ide, COUNT(*) as requests, COUNT(DISTINCT device_fingerprint) as devices
    FROM request_logs
    WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
      AND created_at >= ${range.start}
      ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
      AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    GROUP BY ide_detected
    ORDER BY requests DESC
  `)).rows as any[], ["requests", "devices"]);

  return c.json(rows);
});

// ─── Keys ─────────────────────────────────────────────────────────────────────

portal.get("/keys", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const userKeys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  const result = [];

  for (const key of userKeys) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStats = (await db.select({
      requests: turnCountSql(and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${todayStart}`)),
    }).from(requestLogs).where(and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${todayStart}`)))[0];

    result.push({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      keyMasked: maskKey(key.key),
      isActive: key.isActive,
      isTrial: key.isTrial || false,
      createdAt: key.createdAt,
      requestsToday: todayStats?.requests || 0,
    });
  }
  return c.json(result);
});

portal.post("/keys", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);

  const existing = (await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)).limit(1))[0];
  const newKey = generateApiKey();

  const [result] = await db.insert(apiKeys).values({
    name: name.trim(),
    key: newKey,
    keyPrefix: getKeyPrefix(newKey),
    keyHash: sha256(newKey),
    discordUserId,
    discordUsername: existing?.discordUsername || null,
    provisionedBy: "portal",
    isActive: true,
    maxDevices: existing?.maxDevices || 0,
    devicePolicy: existing?.devicePolicy || "none",
    ipPolicy: existing?.ipPolicy || "none",
    idePolicy: existing?.idePolicy || "none",
    monthlyTokenLimit: existing?.monthlyTokenLimit || null,
    rateLimit: existing?.rateLimit || null,
    rateLimitWindow: existing?.rateLimitWindow || null,
    promptLimit: existing?.promptLimit || null,
    promptLimitWindow: existing?.promptLimitWindow || null,
    dailyTokenLimit: existing?.dailyTokenLimit || null,
    dailyInputTokenLimit: existing?.dailyInputTokenLimit || null,
    dailyOutputTokenLimit: existing?.dailyOutputTokenLimit || null,
  }).returning();

  return c.json({ ...result, key: newKey });
});

portal.post("/keys/:id/rotate", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  const newKey = generateApiKey();
  await db.update(apiKeys).set({
    key: newKey,
    keyPrefix: getKeyPrefix(newKey),
    keyHash: sha256(newKey),
    updatedAt: new Date(),
  }).where(eq(apiKeys.id, keyId));

  const notifications = JSON.parse(key.pendingNotification || "[]");
  notifications.push({
    type: "portal_key_rotated",
    keyName: key.name,
    keyId: key.id,
    rotatedAt: new Date().toISOString(),
    discordUserId,
  });
  await db.update(apiKeys).set({ pendingNotification: JSON.stringify(notifications) }).where(eq(apiKeys.id, keyId));

  return c.json({ success: true, key: newKey, keyPrefix: getKeyPrefix(newKey) });
});

// ─── Devices ───────────────────────────────────────────────────────────────────

portal.get("/keys/:id/devices", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  const devs = await db.select().from(devices).where(eq(devices.apiKeyId, keyId)).orderBy(desc(devices.lastSeen)).limit(50);
  return c.json(devs.map((d: any) => ({
    fingerprint: d.fingerprint,
    deviceName: d.deviceName,
    ideDetected: d.ideDetected,
    osDetected: d.osDetected,
    requestCount: d.requestCount,
    lastSeen: d.lastSeen,
    isBlocked: d.isBlocked,
  })));
});

portal.delete("/keys/:id/devices/:fingerprint", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  await db.delete(devices).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));
  return c.json({ success: true });
});

portal.put("/keys/:id/policies", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));
  const { devicePolicy, idePolicy } = await c.req.json<{ devicePolicy?: string; idePolicy?: string }>();

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  await db.update(apiKeys).set({
    devicePolicy: devicePolicy || key.devicePolicy,
    idePolicy: idePolicy || key.idePolicy,
    updatedAt: new Date(),
  }).where(eq(apiKeys.id, keyId));
  return c.json({ success: true });
});

// ─── Logs ──────────────────────────────────────────────────────────────────────

portal.get("/logs", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "7d") as PeriodKey;
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const page = parseInt(c.req.query("page") || "1");
  const offset = (page - 1) * limit;

  const range = resolvePeriodRange(period);
  const where = and(
    userWhere(discordUserId),
    sql`created_at >= ${range.start}`,
    range.end ? sql`created_at <= ${range.end}` : sql`1=1`
  );

  const rows = await db.select({
    id: requestLogs.id,
    model: requestLogs.model,
    promptTokens: requestLogs.promptTokens,
    completionTokens: requestLogs.completionTokens,
    totalTokens: requestLogs.totalTokens,
    ideDetected: requestLogs.ideDetected,
    provider: requestLogs.provider,
    latencyMs: requestLogs.latencyMs,
    statusCode: requestLogs.statusCode,
    createdAt: requestLogs.createdAt,
  }).from(requestLogs).where(where).orderBy(desc(requestLogs.createdAt)).limit(limit).offset(offset);

  const total = (await db.select({ count: sql<number>`count(*)` }).from(requestLogs).where(where))[0];

  return c.json({
    data: rows,
    pagination: { page, limit, total: Number(total?.count) || 0, totalPages: Math.ceil((Number(total?.count) || 0) / limit) },
  });
});

// ─── Settings ───────────────────────────────────────────────────────────────────

portal.put("/settings/password", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword?: string; newPassword: string }>();

  if (!newPassword || newPassword.length < 6) return c.json({ error: "Password must be at least 6 characters" }, 400);

  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];

  if (settings?.passwordHash) {
    if (!currentPassword) return c.json({ error: "Current password required" }, 400);
    const { verify } = await import("@node-rs/argon2");
    const isValid = await verify(settings.passwordHash, currentPassword);
    if (!isValid) return c.json({ error: "Invalid current password" }, 401);
  }

  const { hash } = await import("@node-rs/argon2");
  const newHash = await hash(newPassword);

  if (settings) {
    await db.update(userPortalSettings).set({ passwordHash: newHash, passwordSetAt: new Date(), updatedAt: new Date() }).where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({ discordUserId, passwordHash: newHash, passwordSetAt: new Date() });
  }

  return c.json({ success: true });
});

portal.delete("/settings/password", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  await db.update(userPortalSettings).set({ passwordHash: null, passwordSetAt: null, updatedAt: new Date() }).where(eq(userPortalSettings.discordUserId, discordUserId));
  return c.json({ success: true });
});

export default portal;
