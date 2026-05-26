import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { adminConfig, allowedDevices, allowedIdes, apiKeys, devices, requestLogs, modelLimits } from "../../db/schema.js";
import { generateApiKey, getKeyPrefix, sha256 } from "../../utils/crypto.js";
import { normalizeIdeName } from "../../utils/detect-ide.js";

const internal = new Hono();

type UserBody = {
  discordUserId: string;
  discordUsername?: string;
  sourceThreadId?: string;
  sourceGuildId?: string;
  reason?: string;
};

async function findKeyByDiscordUser(discordUserId: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)).get();
}

async function getUserStats(apiKeyId: number) {
  const usage = await db.select({
    requests: sql<number>`count(*)`,
    tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
    completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
  }).from(requestLogs).where(eq(requestLogs.apiKeyId, apiKeyId)).get();

  const uniqueDevices = await db.select({ count: sql<number>`count(*)` })
    .from(devices)
    .where(eq(devices.apiKeyId, apiKeyId))
    .get();

  return {
    requests: usage?.requests || 0,
    tokens: usage?.tokens || 0,
    promptTokens: usage?.promptTokens || 0,
    completionTokens: usage?.completionTokens || 0,
    uniqueDevices: uniqueDevices?.count || 0,
  };
}

internal.get("/internal/ping", (c) => c.json({ ok: true, ts: Date.now() }));

internal.post("/internal/set-global-max-devices", async (c) => {
  const body = await c.req.json<{ maxDevices: number }>();
  if (body.maxDevices === undefined) return c.json({ error: "maxDevices required" }, 400);

  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin config missing" }, 500);

  await db.update(adminConfig).set({
    globalMaxDevices: body.maxDevices,
    updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19)
  }).where(eq(adminConfig.id, config.id)).run();

  return c.json({ success: true, maxDevices: body.maxDevices });
});

internal.post("/internal/verify-user", async (c) => {
  const body = await c.req.json<UserBody>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);

  const normalizedUsername = String(body.discordUsername || body.discordUserId).trim();
  const displayName = `Discord-${normalizedUsername}-${body.discordUserId}`;

  const existing = await findKeyByDiscordUser(body.discordUserId);
  let keyPlaintext = "";
  let keyId = 0;
  let created = false;

  const config = await db.select().from(adminConfig).get();
  const maxDevices = config?.globalMaxDevices ?? 1;

  if (existing) {
    keyPlaintext = existing.key;
    keyId = existing.id;
    await db.update(apiKeys)
      .set({
        name: displayName,
        isActive: true,
        discordUsername: body.discordUsername || existing.discordUsername,
        maxDevices,
        updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      })
      .where(eq(apiKeys.id, existing.id))
      .run();
  } else {
    created = true;
    keyPlaintext = generateApiKey();
    const inserted = await db.insert(apiKeys)
      .values({
        name: displayName,
        key: keyPlaintext,
        keyPrefix: getKeyPrefix(keyPlaintext),
        keyHash: sha256(keyPlaintext),
        discordUserId: body.discordUserId,
        discordUsername: body.discordUsername || null,
        provisionedBy: "discord-bot",
        isActive: true,
        maxDevices,
      })
      .returning()
      .get();
    keyId = inserted.id;
  }

  return c.json({
    success: true,
    created,
    keyId,
    apiKey: keyPlaintext,
    endpoint: `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`,
    policy: {
      maxDevices,
      note: "Max device policy enforced for Discord-provisioned keys",
    },
  });
});

internal.post("/internal/update-key-rate-limit", async (c) => {
  const body = await c.req.json<{ discordUserId: string; rateLimit: number; rateLimitWindow: string }>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);

  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ success: false, error: "No key found for discord user" }, 404);

  await db.update(apiKeys)
    .set({
      rateLimit: Number(body.rateLimit) || 0,
      rateLimitWindow: String(body.rateLimitWindow || ""),
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
    })
    .where(eq(apiKeys.id, existing.id))
    .run();

  return c.json({ success: true, message: "Rate limit updated" });
});

internal.post("/internal/update-key-prompt-limit", async (c) => {
  const body = await c.req.json<{ discordUserId: string; promptLimit: number; promptLimitWindow: string }>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);

  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ success: false, error: "No key found for discord user" }, 404);

  await db.update(apiKeys)
    .set({
      promptLimit: Number(body.promptLimit) || 0,
      promptLimitWindow: String(body.promptLimitWindow || ""),
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
    })
    .where(eq(apiKeys.id, existing.id))
    .run();

  return c.json({ success: true, message: "Prompt limit updated" });
});

internal.post("/internal/update-key-model-limit", async (c) => {
  const body = await c.req.json<{ discordUserId: string; model: string; promptLimit: number }>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);
  if (!body.model) return c.json({ error: "model is required" }, 400);

  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ success: false, error: "No key found for discord user" }, 404);

  const modelName = body.model.trim();
  const limit = Math.max(0, Number(body.promptLimit) || 0);

  // Upsert: delete then insert
  await db.delete(modelLimits).where(and(
    eq(modelLimits.scope, "key"),
    eq(modelLimits.scopeId, existing.id),
    eq(modelLimits.model, modelName),
  )).run();

  if (limit > 0) {
    await db.insert(modelLimits).values({
      scope: "key", scopeId: existing.id, model: modelName, promptLimit: limit,
    }).run();
  }

  return c.json({ success: true, model: modelName, promptLimit: limit });
});

internal.post("/internal/revoke-user", async (c) => {
  const body = await c.req.json<UserBody>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);
  const reason = String(body.reason || "Violation / policy enforcement").trim();

  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ success: true, message: "No key found for user" });

  await db.update(apiKeys)
    .set({ isActive: false, updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) })
    .where(eq(apiKeys.id, existing.id))
    .run();

  return c.json({ success: true, message: "API key revoked", reason, keyId: existing.id });
});

internal.post("/internal/refresh-user-key", async (c) => {
  const body = await c.req.json<UserBody>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);

  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for discord user" }, 404);

  const newKey = generateApiKey();
  await db.update(apiKeys)
    .set({
      key: newKey,
      keyPrefix: getKeyPrefix(newKey),
      keyHash: sha256(newKey),
      isActive: true,
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
    })
    .where(eq(apiKeys.id, existing.id))
    .run();

  return c.json({
    success: true,
    apiKey: newKey,
    endpoint: `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`,
  });
});

internal.post("/internal/reset-user", async (c) => {
  const body = await c.req.json<UserBody>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);

  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for discord user" }, 404);

  await db.delete(requestLogs).where(eq(requestLogs.apiKeyId, existing.id)).run();
  await db.delete(devices).where(eq(devices.apiKeyId, existing.id)).run();
  await db.delete(allowedDevices).where(eq(allowedDevices.apiKeyId, existing.id)).run();
  await db.delete(allowedIdes).where(eq(allowedIdes.apiKeyId, existing.id)).run();

  await db.update(apiKeys)
    .set({
      devicePolicy: "none",
      ipPolicy: "none",
      idePolicy: "none",
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
    })
    .where(eq(apiKeys.id, existing.id))
    .run();

  return c.json({ success: true, message: "User usage and policy data reset" });
});

internal.get("/internal/user/:discordUserId", async (c) => {
  const discordUserId = c.req.param("discordUserId");
  const existing = await findKeyByDiscordUser(discordUserId);
  if (!existing) return c.json({ found: false });

  const stats = await getUserStats(existing.id);
  return c.json({
    found: true,
    key: {
      id: existing.id,
      name: existing.name,
      keyMasked: `${existing.keyPrefix}...${existing.key.slice(-4)}`,
      isActive: existing.isActive,
      discordUserId: existing.discordUserId,
      discordUsername: existing.discordUsername,
      devicePolicy: existing.devicePolicy,
      ipPolicy: existing.ipPolicy,
      idePolicy: existing.idePolicy,
      monthlyTokenLimit: existing.monthlyTokenLimit,
      rateLimit: existing.rateLimit,
      rateLimitWindow: existing.rateLimitWindow,
      promptLimit: existing.promptLimit,
      promptLimitWindow: existing.promptLimitWindow,
      perModelPromptLimit: existing.perModelPromptLimit,
      perModelPromptLimitWindow: existing.perModelPromptLimitWindow,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    },
    stats,
  });
});

internal.get("/internal/keys", async (c) => {
  const keys = await db.select().from(apiKeys).where(sql`discord_user_id IS NOT NULL`).all();
  return c.json(keys.map((k) => ({
    id: k.id,
    discordUserId: k.discordUserId,
    discordUsername: k.discordUsername,
    keyMasked: `${k.keyPrefix}...${k.key.slice(-4)}`,
    isActive: k.isActive,
    createdAt: k.createdAt,
  })));
});

internal.post("/internal/ip-policy", async (c) => {
  const body = await c.req.json<{ discordUserId: string; ipAddress: string; mode: "allow" | "block" | "remove" }>();
  if (!body.discordUserId || !body.ipAddress || !body.mode) return c.json({ error: "discordUserId, ipAddress, mode required" }, 400);
  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for discord user" }, 404);

  if (body.mode === "allow") {
    const row = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.ipAddress, body.ipAddress), eq(allowedDevices.listType, "allow"))).get();
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, ipAddress: body.ipAddress, listType: "allow", label: "Set by Discord admin" }).run();
    await db.update(apiKeys).set({ ipPolicy: "allowlist", updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) }).where(eq(apiKeys.id, existing.id)).run();
  } else if (body.mode === "block") {
    const row = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.ipAddress, body.ipAddress), eq(allowedDevices.listType, "block"))).get();
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, ipAddress: body.ipAddress, listType: "block", label: "Set by Discord admin" }).run();
    await db.update(apiKeys).set({ ipPolicy: "blacklist", updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) }).where(eq(apiKeys.id, existing.id)).run();
  } else {
    await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.ipAddress, body.ipAddress))).run();
  }

  return c.json({ success: true });
});

internal.post("/internal/device-policy", async (c) => {
  const body = await c.req.json<{ discordUserId: string; fingerprint: string; mode: "allow" | "block" | "remove" }>();
  if (!body.discordUserId || !body.fingerprint || !body.mode) return c.json({ error: "discordUserId, fingerprint, mode required" }, 400);
  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for discord user" }, 404);

  if (body.mode === "allow") {
    const row = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.fingerprint, body.fingerprint), eq(allowedDevices.listType, "allow"))).get();
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, fingerprint: body.fingerprint, listType: "allow", label: "Set by Discord admin" }).run();
    await db.update(apiKeys).set({ devicePolicy: "allowlist", updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) }).where(eq(apiKeys.id, existing.id)).run();
  } else if (body.mode === "block") {
    const row = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.fingerprint, body.fingerprint), eq(allowedDevices.listType, "block"))).get();
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, fingerprint: body.fingerprint, listType: "block", label: "Set by Discord admin" }).run();
    await db.update(apiKeys).set({ devicePolicy: "blacklist", updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) }).where(eq(apiKeys.id, existing.id)).run();
  } else {
    await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.fingerprint, body.fingerprint))).run();
  }

  return c.json({ success: true });
});

internal.post("/internal/ide-policy", async (c) => {
  const body = await c.req.json<{ discordUserId: string; ideName: string; mode: "allow" | "block" | "remove" }>();
  if (!body.discordUserId || !body.ideName || !body.mode) return c.json({ error: "discordUserId, ideName, mode required" }, 400);
  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for discord user" }, 404);
  const normalizedIde = normalizeIdeName(body.ideName);

  if (body.mode === "allow") {
    const row = await db.select().from(allowedIdes).where(and(eq(allowedIdes.apiKeyId, existing.id), eq(allowedIdes.ideName, normalizedIde), eq(allowedIdes.listType, "allow"))).get();
    if (!row) await db.insert(allowedIdes).values({ apiKeyId: existing.id, ideName: normalizedIde, listType: "allow" }).run();
    await db.update(apiKeys).set({ idePolicy: "allowlist", updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) }).where(eq(apiKeys.id, existing.id)).run();
  } else if (body.mode === "block") {
    const row = await db.select().from(allowedIdes).where(and(eq(allowedIdes.apiKeyId, existing.id), eq(allowedIdes.ideName, normalizedIde), eq(allowedIdes.listType, "block"))).get();
    if (!row) await db.insert(allowedIdes).values({ apiKeyId: existing.id, ideName: normalizedIde, listType: "block" }).run();
    await db.update(apiKeys).set({ idePolicy: "blacklist", updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) }).where(eq(apiKeys.id, existing.id)).run();
  } else {
    await db.delete(allowedIdes).where(and(eq(allowedIdes.apiKeyId, existing.id), eq(allowedIdes.ideName, normalizedIde))).run();
  }

  return c.json({ success: true });
});

internal.get("/internal/stats/overview", async (c) => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const today = await db.select({
    requests: sql<number>`count(*)`,
    tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
  }).from(requestLogs).where(sql`created_at >= ${todayStart.toISOString()}`).get();

  const activeDiscordKeys = await db.select({ count: sql<number>`count(*)` })
    .from(apiKeys)
    .where(and(sql`discord_user_id IS NOT NULL`, eq(apiKeys.isActive, true)))
    .get();

  return c.json({
    todayRequests: today?.requests || 0,
    todayTokens: today?.tokens || 0,
    activeDiscordKeys: activeDiscordKeys?.count || 0,
  });
});

// ─── Ranking Endpoint ──────────────────────────────────────────────────────────
internal.get("/internal/stats/ranking", async (c) => {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString().replace("T", " ").substring(0, 19);
  const monthStr = monthStart.toISOString().replace("T", " ").substring(0, 19);

  async function getTopModelsByRequests(since: string) {
    return db.select({
      model: requestLogs.model,
      count: sql<number>`count(*)`,
      tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    })
    .from(requestLogs)
    .where(and(sql`created_at >= ${since}`, sql`is_counted_request IS NOT 0`))
    .groupBy(requestLogs.model)
    .orderBy(sql`count(*) DESC`)
    .limit(10)
    .all();
  }

  async function getTopModelsByTokens(since: string) {
    return db.select({
      model: requestLogs.model,
      count: sql<number>`count(*)`,
      tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    })
    .from(requestLogs)
    .where(and(sql`created_at >= ${since}`, sql`is_counted_request IS NOT 0`))
    .groupBy(requestLogs.model)
    .orderBy(sql`COALESCE(SUM(total_tokens), 0) DESC`)
    .limit(10)
    .all();
  }

  async function getTopUsersByRequests(since: string) {
    const rows = await db.select({
      apiKeyId: requestLogs.apiKeyId,
      requests: sql<number>`count(*)`,
      tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    })
    .from(requestLogs)
    .where(and(sql`created_at >= ${since}`, sql`is_counted_request IS NOT 0`))
    .groupBy(requestLogs.apiKeyId)
    .orderBy(sql`count(*) DESC`)
    .limit(20)
    .all();

    const result = [];
    for (const row of rows) {
      if (!row.apiKeyId) continue;
      const key = await db.select({ discordUserId: apiKeys.discordUserId, discordUsername: apiKeys.discordUsername, name: apiKeys.name })
        .from(apiKeys).where(eq(apiKeys.id, row.apiKeyId)).get();
      if (!key) continue;
      result.push({
        discordUserId: key.discordUserId,
        discordUsername: key.discordUsername || key.name,
        requests: row.requests,
        tokens: row.tokens,
      });
      if (result.length >= 10) break;
    }
    return result;
  }

  async function getTopUsersByTokens(since: string) {
    const rows = await db.select({
      apiKeyId: requestLogs.apiKeyId,
      requests: sql<number>`count(*)`,
      tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
    })
    .from(requestLogs)
    .where(and(sql`created_at >= ${since}`, sql`is_counted_request IS NOT 0`))
    .groupBy(requestLogs.apiKeyId)
    .orderBy(sql`COALESCE(SUM(total_tokens), 0) DESC`)
    .limit(20)
    .all();

    const result = [];
    for (const row of rows) {
      if (!row.apiKeyId) continue;
      const key = await db.select({ discordUserId: apiKeys.discordUserId, discordUsername: apiKeys.discordUsername, name: apiKeys.name })
        .from(apiKeys).where(eq(apiKeys.id, row.apiKeyId)).get();
      if (!key) continue;
      result.push({
        discordUserId: key.discordUserId,
        discordUsername: key.discordUsername || key.name,
        requests: row.requests,
        tokens: row.tokens,
      });
      if (result.length >= 10) break;
    }
    return result;
  }

  const [
    todayModelsByReq,
    monthModelsByReq,
    todayModelsByTok,
    monthModelsByTok,
    todayUsersByReq,
    monthUsersByReq,
    todayUsersByTok,
    monthUsersByTok,
  ] = await Promise.all([
    getTopModelsByRequests(todayStr),
    getTopModelsByRequests(monthStr),
    getTopModelsByTokens(todayStr),
    getTopModelsByTokens(monthStr),
    getTopUsersByRequests(todayStr),
    getTopUsersByRequests(monthStr),
    getTopUsersByTokens(todayStr),
    getTopUsersByTokens(monthStr),
  ]);

  return c.json({
    today: {
      topModelsByRequests: todayModelsByReq,
      topModelsByTokens: todayModelsByTok,
      topUsersByRequests: todayUsersByReq,
      topUsersByTokens: todayUsersByTok,
    },
    month: {
      topModelsByRequests: monthModelsByReq,
      topModelsByTokens: monthModelsByTok,
      topUsersByRequests: monthUsersByReq,
      topUsersByTokens: monthUsersByTok,
    },
  });
});

// ─── User Detail Endpoint ──────────────────────────────────────────────────────
internal.get("/internal/stats/user-detail/:discordUserId", async (c) => {
  const discordUserId = c.req.param("discordUserId");
  const key = await findKeyByDiscordUser(discordUserId);
  if (!key) return c.json({ error: "User not found" }, 404);

  const keyId = key.id;
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString().replace("T", " ").substring(0, 19);
  const monthStr = monthStart.toISOString().replace("T", " ").substring(0, 19);

  async function getPeriodStats(since: string) {
    return db.select({
      requests: sql<number>`count(*)`,
      tokens: sql<number>`COALESCE(SUM(total_tokens), 0)`,
      promptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
      completionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
      contextTokens: sql<number>`COALESCE(SUM(estimated_context_length), 0)`,
      estimatedCost: sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, keyId),
      sql`created_at >= ${since}`,
      sql`is_counted_request IS NOT 0`
    ))
    .get();
  }

  const [todayStats, monthStats] = await Promise.all([
    getPeriodStats(todayStr),
    getPeriodStats(monthStr),
  ]);

  return c.json({
    discordUserId: key.discordUserId,
    discordUsername: key.discordUsername || key.name,
    isActive: key.isActive,
    keyPrefix: key.keyPrefix,
    today: {
      requests: todayStats?.requests || 0,
      tokens: todayStats?.tokens || 0,
      promptTokens: todayStats?.promptTokens || 0,
      completionTokens: todayStats?.completionTokens || 0,
      contextTokens: todayStats?.contextTokens || 0,
      estimatedCost: todayStats?.estimatedCost || 0,
    },
    month: {
      requests: monthStats?.requests || 0,
      tokens: monthStats?.tokens || 0,
      promptTokens: monthStats?.promptTokens || 0,
      completionTokens: monthStats?.completionTokens || 0,
      contextTokens: monthStats?.contextTokens || 0,
      estimatedCost: monthStats?.estimatedCost || 0,
    },
  });
});

// ─── Pending Notifications (for bot polling) ────────────────────────────────
internal.get("/internal/pending-notifications", async (c) => {
  const rows = await db.select({
    id: apiKeys.id,
    discordUserId: apiKeys.discordUserId,
    pendingNotification: apiKeys.pendingNotification,
  })
  .from(apiKeys)
  .where(sql`pending_notification IS NOT NULL AND pending_notification != ''`)
  .all();

  return c.json({
    notifications: rows.map(r => ({
      keyId: r.id,
      discordUserId: r.discordUserId,
      ...(JSON.parse(r.pendingNotification || "{}")),
    }))
  });
});

internal.post("/internal/clear-notification/:keyId", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  await db.update(apiKeys)
    .set({ pendingNotification: null })
    .where(eq(apiKeys.id, keyId))
    .run();
  return c.json({ success: true });
});

export default internal;