import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { adminConfig, allowedDevices, allowedIdes, apiKeys, devices, requestLogs, modelLimits, providers } from "../../db/schema.js";
import { generateApiKey, getKeyPrefix, sha256 } from "../../utils/crypto.js";
import { normalizeIdeName } from "../../utils/detect-ide.js";
import { checkPromptLimit, checkModelPromptLimit, parseRateLimitWindow, getWindowResetMs } from "../../utils/rate-limit.js";
import { isInternalRequest } from "../../middleware/session.js";
import { BILLABLE_LOG_SQL, COUNTED_LOG_SQL, VALID_LOG_SQL, turnCountSql, turnPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql } from "../../utils/counting.js";

const internal = new Hono();

const checkInternal = (c: any) => {
  if (!isInternalRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
};

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
  const whereClause = and(eq(requestLogs.apiKeyId, apiKeyId), VALID_LOG_SQL);
  const usage = await db.select({
    requests: turnCountSql(whereClause),
    tokens: turnTotalTokensSql(whereClause),
    promptTokens: turnPromptTokensSql(whereClause),
    completionTokens: turnCompletionTokensSql(whereClause),
  }).from(requestLogs).where(whereClause).get();

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
  if (!body.discordUserId) return c.json({ error: "No key found for user" }, 404);

  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for user" }, 404);

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
  if (!existing) return c.json({ error: "No key found for user" }, 404);

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
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);

  const todayStr = todayStart.toISOString().replace("T", " ").substring(0, 19);
  const todayWhere = and(sql`created_at >= ${todayStr}`, VALID_LOG_SQL);
  const today = await db.select({
    requests: turnCountSql(todayWhere),
    tokens: turnTotalTokensSql(todayWhere),
  }).from(requestLogs).where(todayWhere).get();

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

internal.get("/internal/stats/ranking", async (c) => {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);
  const monthStart = new Date(wibNow); monthStart.setUTCDate(1);
  const monthStartFinal = new Date(monthStart.getTime() - wibOffset);
  const todayStr = todayStart.toISOString().replace("T", " ").substring(0, 19);
  const monthStr = monthStartFinal.toISOString().replace("T", " ").substring(0, 19);

  async function getTopModelsByRequests(since: string) {
    const rows = await db.all(sql`
      SELECT model, COUNT(*) as count, COALESCE(SUM(sum_delta + sum_c), 0) as tokens
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTR(model, 7, INSTR(SUBSTR(model, 7), ')') - 1)) as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY TRIM(SUBSTR(model, 7, INSTR(SUBSTR(model, 7), ')') - 1)), turn_id
      )
      GROUP BY model ORDER BY count DESC LIMIT 10
    `);
    return rows as any[];
  }

  async function getTopModelsByTokens(since: string) {
    const rows = await db.all(sql`
      SELECT model, COUNT(*) as count, COALESCE(SUM(sum_delta + sum_c), 0) as tokens
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTR(model, 7, INSTR(SUBSTR(model, 7), ')') - 1)) as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY TRIM(SUBSTR(model, 7, INSTR(SUBSTR(model, 7), ')') - 1)), turn_id
      )
      GROUP BY model ORDER BY tokens DESC LIMIT 10
    `);
    return rows as any[];
  }

  async function getTopUsersByRequests(since: string) {
    const rows = await db.all(sql`
      SELECT api_key_id as apiKeyId, COUNT(*) as requests, COALESCE(SUM(sum_delta + sum_c), 0) as tokens
      FROM (SELECT api_key_id, turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 AND is_counted_request = 1
        GROUP BY api_key_id, turn_id)
      GROUP BY api_key_id ORDER BY requests DESC LIMIT 20
    `);

    const result = [];
    for (const row of rows as any[]) {
      if (!row.apiKeyId) continue;
      const key = await db.select({ discordUserId: apiKeys.discordUserId, discordUsername: apiKeys.discordUsername, name: apiKeys.name })
        .from(apiKeys).where(eq(apiKeys.id, row.apiKeyId)).get();
      if (!key) continue;
      result.push({
        discordUserId: key.discordUserId,
        discordUsername: key.discordUsername || key.name,
        keyName: key.name,
        requests: row.requests,
        tokens: row.tokens,
      });
      if (result.length >= 10) break;
    }
    return result;
  }

  async function getTopUsersByTokens(since: string) {
    const rows = await db.all(sql`
      SELECT api_key_id as apiKeyId, COUNT(*) as requests,
        COALESCE(SUM(sum_delta + sum_c), 0) as tokens,
        COALESCE(SUM(sum_delta), 0) as promptTokens,
        COALESCE(SUM(sum_c), 0) as completionTokens
      FROM (SELECT api_key_id, turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 AND is_billable_token = 1
        GROUP BY api_key_id, turn_id)
      GROUP BY api_key_id ORDER BY tokens DESC LIMIT 20
    `);

    const result = [];
    for (const row of rows as any[]) {
      if (!row.apiKeyId) continue;
      const key = await db.select({ discordUserId: apiKeys.discordUserId, discordUsername: apiKeys.discordUsername, name: apiKeys.name })
        .from(apiKeys).where(eq(apiKeys.id, row.apiKeyId)).get();
      if (!key) continue;

      const estimatedCost = Math.round((row.promptTokens || 0) * 1.5 + (row.completionTokens || 0) * 6.0);

      result.push({
        discordUserId: key.discordUserId,
        discordUsername: key.discordUsername || key.name,
        keyName: key.name,
        requests: row.requests,
        tokens: row.tokens,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        estimatedCost,
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

internal.get("/internal/stats/user-detail/:discordUserId", async (c) => {
  const discordUserId = c.req.param("discordUserId");
  const key = await findKeyByDiscordUser(discordUserId);
  if (!key) return c.json({ error: "User not found" }, 404);

  const keyId = key.id;
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);
  const monthWib = new Date(wibNow); monthWib.setUTCDate(1);
  const monthStart = new Date(monthWib.getTime() - wibOffset);
  const todayStr = todayStart.toISOString().replace("T", " ").substring(0, 19);
  const monthStr = monthStart.toISOString().replace("T", " ").substring(0, 19);

  async function getTopModels(since: string) {
    const rows = await db.all(sql`
      SELECT model, COUNT(*) as requests, COALESCE(SUM(sum_delta + sum_c), 0) as tokens
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${keyId} AND created_at >= ${since} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTR(model, 7, INSTR(SUBSTR(model, 7), ')') - 1)) as model,
          turn_id, SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND api_key_id = ${keyId} AND created_at >= ${since} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY TRIM(SUBSTR(model, 7, INSTR(SUBSTR(model, 7), ')') - 1)), turn_id
      )
      GROUP BY model ORDER BY tokens DESC LIMIT 3
    `);
    return rows as any[];
  }

  async function getPeriodStats(since: string) {
    const whereClause = and(eq(requestLogs.apiKeyId, keyId), sql`created_at >= ${since}`, VALID_LOG_SQL);
    return db.select({
      requests: turnCountSql(whereClause),
      tokens: turnTotalTokensSql(whereClause),
      promptTokens: turnPromptTokensSql(whereClause),
      completionTokens: turnCompletionTokensSql(whereClause),
      contextTokens: sql<number>`0`,
      estimatedCost: sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    })
    .from(requestLogs)
    .where(whereClause)
    .get();
  }

  const [todayStats, monthStats, todayModels, monthModels] = await Promise.all([
    getPeriodStats(todayStr),
    getPeriodStats(monthStr),
    getTopModels(todayStr),
    getTopModels(monthStr),
  ]);

  const config = await db.select().from(adminConfig).get();

  const globalLimit = key.promptLimit && key.promptLimit > 0 ? key.promptLimit : config?.globalPromptLimit || 0;
  const globalWindow = key.promptLimitWindow || config?.globalPromptLimitWindow || "30m";
  let globalUsed = 0;
  let globalResetMins = 0;

  if (globalLimit > 0) {
    const plCheck = await checkPromptLimit(key.id, globalLimit, globalWindow);
    globalUsed = plCheck.used;
    const windowMs = parseRateLimitWindow(globalWindow);
    const resetMs = await getWindowResetMs(key.id, windowMs);
    globalResetMins = Math.ceil(resetMs / 60000);
  }

  const activeModelLimits = await db.select().from(modelLimits).where(eq(modelLimits.scope, 'global')).all();
  const perModelLimitFallback = key.perModelPromptLimit && key.perModelPromptLimit > 0 ? key.perModelPromptLimit : config?.globalPerModelPromptLimit || 0;
  const perModelWindowFallback = key.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "30m";

  const modelUsage = [];
  for (const tm of todayModels) {
    if (!tm.model) continue;
    const mlCheck = await checkModelPromptLimit(
      key.id,
      tm.model,
      key.perModelPromptLimit || 0,
      key.perModelPromptLimitWindow || null,
      config?.globalPerModelPromptLimit || 0,
      config?.globalPerModelPromptLimitWindow || "30m"
    );
    const windowStr = key.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "30m";
    const windowMs = parseRateLimitWindow(windowStr);
    const resetMs = await getWindowResetMs(key.id, windowMs, tm.model);
    modelUsage.push({
      model: tm.model,
      used: mlCheck.used,
      limit: mlCheck.effectiveLimit,
      resetMins: Math.ceil(resetMs / 60000),
      window: windowStr
    });
  }

  for (const am of activeModelLimits) {
    if (!modelUsage.find(m => m.model === am.model)) {
      modelUsage.push({
        model: am.model,
        used: 0,
        limit: am.promptLimit,
        resetMins: 0,
        window: perModelWindowFallback
      });
    }
  }

  return c.json({
    discordUserId: key.discordUserId,
    discordUsername: key.discordUsername || key.name,
    isActive: key.isActive,
    keyPrefix: key.keyPrefix,
    key: key.key,
    promptLimit: globalLimit,
    promptLimitWindow: globalWindow,
    promptUsed: globalUsed,
    promptResetMins: globalResetMins,
    modelUsage,
    perModelPromptLimit: perModelLimitFallback,
    perModelPromptLimitWindow: perModelWindowFallback,
    dailyTokenLimit: config?.globalDailyTokenLimit || 0,
    monthlyTokenLimit: config?.globalMonthlyTokenLimit || 0,
    dailyInputTokenLimit: (key.dailyInputTokenLimit && key.dailyInputTokenLimit > 0) ? key.dailyInputTokenLimit : (config?.globalDailyInputTokenLimit || 0),
    dailyOutputTokenLimit: (key.dailyOutputTokenLimit && key.dailyOutputTokenLimit > 0) ? key.dailyOutputTokenLimit : (config?.globalDailyOutputTokenLimit || 0),
    dailyTokensUsed: todayStats?.tokens || 0,
    monthlyTokensUsed: monthStats?.tokens || 0,
    dailyInputUsed: todayStats?.promptTokens || 0,
    dailyOutputUsed: todayStats?.completionTokens || 0,
      today: {
        requests: todayStats?.requests || 0,
        tokens: todayStats?.tokens || 0,
        promptTokens: todayStats?.promptTokens || 0,
        completionTokens: todayStats?.completionTokens || 0,
        contextTokens: todayStats?.contextTokens || 0,
        estimatedCost: todayStats?.estimatedCost || 0,
        topModels: todayModels,
      },
      month: {
        requests: monthStats?.requests || 0,
        tokens: monthStats?.tokens || 0,
        promptTokens: monthStats?.promptTokens || 0,
        completionTokens: monthStats?.completionTokens || 0,
        contextTokens: monthStats?.contextTokens || 0,
        estimatedCost: monthStats?.estimatedCost || 0,
        topModels: monthModels,
      },
  });
});

internal.get("/internal/providers", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const provs = await db.select().from(providers).where(eq(providers.isActive, true)).orderBy(providers.priority).all();
  return c.json(provs);
});

internal.get("/internal/pending-notifications", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const rows = await db
    .select({ id: apiKeys.id, pendingNotification: apiKeys.pendingNotification })
    .from(apiKeys)
    .all();

  const notifications = rows
    .filter((r) => r.pendingNotification)
    .map((r) => {
      try {
        const parsed = JSON.parse(r.pendingNotification!);
        return { keyId: r.id, ...parsed };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return c.json({ notifications });
});

internal.post("/internal/rotate-all-keys", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const endpoint = `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`;
  const activeKeys = await db.select().from(apiKeys).where(eq(apiKeys.isActive, true)).all();
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  let rotated = 0;
  let notified = 0;

  for (const key of activeKeys) {
    const newKey = generateApiKey();
    const notification = key.discordUserId
      ? JSON.stringify({
          type: "admin_bulk_rotate",
          discordUserId: key.discordUserId,
          newKey,
          endpoint,
          keyId: key.id,
        })
      : null;

    await db
      .update(apiKeys)
      .set({
        key: newKey,
        keyPrefix: getKeyPrefix(newKey),
        keyHash: sha256(newKey),
        isActive: true,
        pendingNotification: notification,
        updatedAt: now,
      })
      .where(eq(apiKeys.id, key.id))
      .run();

    await db.delete(devices).where(eq(devices.apiKeyId, key.id)).run();
    rotated += 1;
    if (key.discordUserId) notified += 1;
  }

  return c.json({ success: true, rotated, notified, endpoint });
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
