import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { adminConfig, allowedDevices, allowedIdes, apiKeys, devices, requestLogs, modelLimits, providers, trialUsers, userPortalSettings } from "../../db/schema.js";
import { generateApiKey, getKeyPrefix, sha256 } from "../../utils/crypto.js";
import { getModelRates } from "../../utils/cost-calculator.js";
import { normalizeIdeName } from "../../utils/detect-ide.js";
import { checkPromptLimit, checkModelPromptLimit, checkApiCallLimit, parseRateLimitWindow, getWindowResetMs, getApiCallWindowResetMs } from "../../utils/rate-limit.js";
import { isInternalRequest } from "../../middleware/session.js";
import { configCache } from "../../utils/cache.js";
import { BILLABLE_LOG_SQL, COUNTED_LOG_SQL, VALID_LOG_SQL, turnCountSql, turnPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql, turnBillablePromptTokensSql, turnCachedTokensSql, sanitizeRows, groupedInputSumSql, getTokenInputModeSync } from "../../utils/counting.js";
import { getTokenMultipliers } from "../../utils/token-multiplier.js";
import { getModelCatalogResponse } from "../../utils/model-catalog.js";
import { resolveKeyDailyTokenLimit, resolveKeyPromptLimit, resolveKeyApiCallLimit } from "../../utils/trial-config.js";
import { listGpyCatalogModels } from "../../utils/trial-routing.js";

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
  return (await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)))[0];
}

async function findBestKeyForDiscordUser(discordUserId: string, targetUserId?: string) {
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  if (keys.length === 0) return null;

  const now = new Date();
  const activeTrials = await db.select().from(trialUsers).where(eq(trialUsers.discordUserId, discordUserId));
  const activeTrialKeyIds = new Set(
    activeTrials.filter((t) => !t.endedAt && !t.suspended && t.expiresAt > now).map((t) => t.apiKeyId),
  );

  // Prefer active trial key when viewing self or trial user
  const trialKey = keys.find((k) => activeTrialKeyIds.has(k.id));
  if (trialKey) return trialKey;

  const memberKey = keys.find((k) => !k.isTrial && k.isActive);
  if (memberKey) return memberKey;

  return keys[0];
}

async function getUserStats(apiKeyId: number) {
  const whereClause = and(eq(requestLogs.apiKeyId, apiKeyId), VALID_LOG_SQL);
  const [usage] = await db.select({
    requests: turnCountSql(whereClause),
    tokens: turnTotalTokensSql(whereClause),
    promptTokens: turnPromptTokensSql(whereClause),
    completionTokens: turnCompletionTokensSql(whereClause),
  }).from(requestLogs).where(whereClause);

  const [uniqueDevices] = await db.select({ count: sql<number>`count(*)` })
    .from(devices)
    .where(eq(devices.apiKeyId, apiKeyId));

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

  const [config] = await db.select().from(adminConfig);
  if (!config) return c.json({ error: "Admin config missing" }, 500);

  await db.update(adminConfig).set({
    globalMaxDevices: body.maxDevices,
    updatedAt: new Date()
  }).where(eq(adminConfig.id, config.id));

  return c.json({ success: true, maxDevices: body.maxDevices });
});

internal.post("/internal/verify-user", async (c) => {
  const body = await c.req.json<UserBody>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);

  const normalizedUsername = String(body.discordUsername || body.discordUserId).trim();
  const displayName = `Discord-${normalizedUsername}-${body.discordUserId}`;

  // Always prefer phantom key (non-trial), not trial key
  const [existingPhantom] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.discordUserId, body.discordUserId), eq(apiKeys.isTrial, false)))
    .limit(1);

  let keyPlaintext = "";
  let keyId = 0;
  let created = false;

  const [config] = await db.select().from(adminConfig);
  const maxDevices = config?.globalMaxDevices ?? 1;

  if (existingPhantom) {
    keyPlaintext = existingPhantom.key;
    keyId = existingPhantom.id;
    await db.update(apiKeys)
      .set({
        name: displayName,
        isActive: true,
        discordUsername: body.discordUsername || existingPhantom.discordUsername,
        maxDevices,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, existingPhantom.id));
  } else {
    created = true;
    keyPlaintext = generateApiKey();
    const [inserted] = await db.insert(apiKeys)
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
      .returning();
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
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, existing.id));

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
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, existing.id));

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
  ));

  if (limit > 0) {
    await db.insert(modelLimits).values({
      scope: "key", scopeId: existing.id, model: modelName, promptLimit: limit,
    });
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
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(apiKeys.id, existing.id));

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
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, existing.id));

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

  await db.delete(requestLogs).where(eq(requestLogs.apiKeyId, existing.id));
  await db.delete(devices).where(eq(devices.apiKeyId, existing.id));
  await db.delete(allowedDevices).where(eq(allowedDevices.apiKeyId, existing.id));
  await db.delete(allowedIdes).where(eq(allowedIdes.apiKeyId, existing.id));

  await db.update(apiKeys)
    .set({
      devicePolicy: "none",
      ipPolicy: "none",
      idePolicy: "none",
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, existing.id));

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
  const keys = await db.select().from(apiKeys).where(sql`discord_user_id IS NOT NULL`);
  return c.json(keys.map((k) => ({
    id: k.id,
    discordUserId: k.discordUserId,
    discordUsername: k.discordUsername,
    keyMasked: `${k.keyPrefix}...${k.key.slice(-4)}`,
    isActive: k.isActive,
    createdAt: k.createdAt,
  })));
});

internal.get("/internal/key-for-user/:userId", async (c) => {
  const userId = c.req.param("userId");

  // Always prefer phantom key, not trial key
  const [phantomKey] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.discordUserId, userId), eq(apiKeys.isTrial, false), eq(apiKeys.isActive, true)))
    .limit(1);

  if (phantomKey) {
    return c.json({
      apiKey: phantomKey.key,
      keyPrefix: phantomKey.keyPrefix,
      isActive: phantomKey.isActive,
      isTrial: false,
      endpoint: `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`,
    });
  }

  // If no phantom key, check for any active key (trial)
  const [anyKey] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.discordUserId, userId), eq(apiKeys.isActive, true)))
    .limit(1);

  if (!anyKey) return c.json({ error: "No key found for user" }, 404);

  return c.json({
    apiKey: anyKey.key,
    keyPrefix: anyKey.keyPrefix,
    isActive: anyKey.isActive,
    isTrial: anyKey.isTrial,
    endpoint: `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`,
  });
});

internal.post("/internal/ip-policy", async (c) => {
  const body = await c.req.json<{ discordUserId: string; ipAddress: string; mode: "allow" | "block" | "remove" }>();
  if (!body.discordUserId || !body.ipAddress || !body.mode) return c.json({ error: "discordUserId, ipAddress, mode required" }, 400);
  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for discord user" }, 404);

  if (body.mode === "allow") {
    const [row] = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.ipAddress, body.ipAddress), eq(allowedDevices.listType, "allow")));
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, ipAddress: body.ipAddress, listType: "allow", label: "Set by Discord admin" });
    await db.update(apiKeys).set({ ipPolicy: "allowlist", updatedAt: new Date() }).where(eq(apiKeys.id, existing.id));
  } else if (body.mode === "block") {
    const [row] = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.ipAddress, body.ipAddress), eq(allowedDevices.listType, "block")));
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, ipAddress: body.ipAddress, listType: "block", label: "Set by Discord admin" });
    await db.update(apiKeys).set({ ipPolicy: "blacklist", updatedAt: new Date() }).where(eq(apiKeys.id, existing.id));
  } else {
    await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.ipAddress, body.ipAddress)));
  }

  return c.json({ success: true });
});

internal.post("/internal/device-policy", async (c) => {
  const body = await c.req.json<{ discordUserId: string; fingerprint: string; mode: "allow" | "block" | "remove" }>();
  if (!body.discordUserId || !body.fingerprint || !body.mode) return c.json({ error: "discordUserId, fingerprint, mode required" }, 400);
  const existing = await findKeyByDiscordUser(body.discordUserId);
  if (!existing) return c.json({ error: "No key found for discord user" }, 404);

  if (body.mode === "allow") {
    const [row] = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.fingerprint, body.fingerprint), eq(allowedDevices.listType, "allow")));
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, fingerprint: body.fingerprint, listType: "allow", label: "Set by Discord admin" });
    await db.update(apiKeys).set({ devicePolicy: "allowlist", updatedAt: new Date() }).where(eq(apiKeys.id, existing.id));
  } else if (body.mode === "block") {
    const [row] = await db.select().from(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.fingerprint, body.fingerprint), eq(allowedDevices.listType, "block")));
    if (!row) await db.insert(allowedDevices).values({ apiKeyId: existing.id, fingerprint: body.fingerprint, listType: "block", label: "Set by Discord admin" });
    await db.update(apiKeys).set({ devicePolicy: "blacklist", updatedAt: new Date() }).where(eq(apiKeys.id, existing.id));
  } else {
    await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, existing.id), eq(allowedDevices.fingerprint, body.fingerprint)));
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
    const [row] = await db.select().from(allowedIdes).where(and(eq(allowedIdes.apiKeyId, existing.id), eq(allowedIdes.ideName, normalizedIde), eq(allowedIdes.listType, "allow")));
    if (!row) await db.insert(allowedIdes).values({ apiKeyId: existing.id, ideName: normalizedIde, listType: "allow" });
    await db.update(apiKeys).set({ idePolicy: "allowlist", updatedAt: new Date() }).where(eq(apiKeys.id, existing.id));
  } else if (body.mode === "block") {
    const [row] = await db.select().from(allowedIdes).where(and(eq(allowedIdes.apiKeyId, existing.id), eq(allowedIdes.ideName, normalizedIde), eq(allowedIdes.listType, "block")));
    if (!row) await db.insert(allowedIdes).values({ apiKeyId: existing.id, ideName: normalizedIde, listType: "block" });
    await db.update(apiKeys).set({ idePolicy: "blacklist", updatedAt: new Date() }).where(eq(apiKeys.id, existing.id));
  } else {
    await db.delete(allowedIdes).where(and(eq(allowedIdes.apiKeyId, existing.id), eq(allowedIdes.ideName, normalizedIde)));
  }

  return c.json({ success: true });
});

internal.get("/internal/stats/overview", async (c) => {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);

  const todayDate = todayStart;
  const todayWhere = and(sql`created_at >= ${todayDate}`, VALID_LOG_SQL);
  const [today] = await db.select({
    requests: turnCountSql(todayWhere),
    tokens: turnTotalTokensSql(todayWhere),
  }).from(requestLogs).where(todayWhere);

  const [activeDiscordKeys] = await db.select({ count: sql<number>`count(*)` })
    .from(apiKeys)
    .where(and(sql`discord_user_id IS NOT NULL`, eq(apiKeys.isActive, true)));

  return c.json({
    todayRequests: today?.requests || 0,
    todayTokens: today?.tokens || 0,
    activeDiscordKeys: activeDiscordKeys?.count || 0,
  });
});

internal.get("/internal/stats/ranking", async (c) => {
  const { input: tmInput, output: tmOutput } = getTokenMultipliers();
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);
  const monthStart = new Date(wibNow); monthStart.setUTCDate(1);
  const monthStartFinal = new Date(monthStart.getTime() - wibOffset);
  const todayDate = todayStart;
  const monthDate = monthStartFinal;

  async function getTopModelsByRequests(since: Date) {
    const rows = sanitizeRows((await db.execute(sql`
      SELECT model, COUNT(*) as count, COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
      )
      GROUP BY model ORDER BY count DESC LIMIT 10
    `)).rows as any[], ['count', 'tokens']);
    return rows as any[];
  }

  async function getTopModelsByTokens(since: Date) {
    const rows = (await db.execute(sql`
      SELECT model, COUNT(*) as count, COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299
        GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
      )
      GROUP BY model ORDER BY tokens DESC LIMIT 10
    `)).rows;
    return rows as any[];
  }

  async function getTopUsersByRequests(since: Date) {
    const rows = (await db.execute(sql`
      SELECT api_key_id as "apiKeyId", COUNT(*) as requests, COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens
      FROM (SELECT api_key_id, turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 AND is_counted_request = true
        GROUP BY api_key_id, turn_id)
      GROUP BY api_key_id ORDER BY requests DESC LIMIT 20
    `)).rows;

    const result = [];
    for (const row of rows as any[]) {
      if (!row.apiKeyId) continue;
      const [key] = await db.select({ discordUserId: apiKeys.discordUserId, discordUsername: apiKeys.discordUsername, name: apiKeys.name, isTrial: apiKeys.isTrial })
        .from(apiKeys).where(eq(apiKeys.id, row.apiKeyId));
      if (!key) continue;
      if (key.isTrial) {
        const whereClause = and(eq(requestLogs.apiKeyId, row.apiKeyId), sql`created_at >= ${since}`, COUNTED_LOG_SQL);
        const [raw] = await db.select({ tokens: turnTotalTokensSql(whereClause, { isTrial: true }) }).from(requestLogs).where(whereClause);
        row.tokens = raw?.tokens ?? row.tokens;
      }
      result.push({
        discordUserId: key.discordUserId,
        discordUsername: key.discordUsername || key.name,
        keyName: key.name,
        isTrial: key.isTrial || false,
        requests: row.requests,
        tokens: row.tokens,
        estimatedCost: 0,
      });
      if (result.length >= 10) break;
    }
    return result;
  }

    async function getTopUsersByTokens(since: Date) {
    const peakMode = getTokenInputModeSync() === "per_turn_peak";
    const rows = (await db.execute(peakMode ? sql`
      SELECT api_key_id as "apiKeyId", COUNT(*) as requests,
        COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens,
        COALESCE(SUM(sum_delta) * ${tmInput}, 0) as "promptTokens",
        COALESCE(SUM(sum_bill) * ${tmInput}, 0) as "billablePromptTokens",
        COALESCE(SUM(sum_cache) * ${tmInput}, 0) as "cachedTokens",
        COALESCE(SUM(sum_c) * ${tmOutput}, 0) as "completionTokens"
      FROM (
        SELECT p.api_key_id, p.turn_id, p.sum_delta, p.sum_bill, p.sum_cache, COALESCE(c.sum_c, 0) as sum_c
        FROM (
          SELECT DISTINCT ON (api_key_id, turn_id)
            api_key_id, turn_id,
            COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0) as sum_delta,
            COALESCE(prompt_tokens, 0) as sum_bill,
            COALESCE(cached_tokens, 0) as sum_cache
          FROM request_logs
          WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 AND is_billable_token = true
          ORDER BY api_key_id, turn_id, (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)) DESC
        ) p
        LEFT JOIN (
          SELECT api_key_id, turn_id, SUM(completion_tokens) as sum_c
          FROM request_logs
          WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 AND is_billable_token = true
          GROUP BY api_key_id, turn_id
        ) c ON c.api_key_id = p.api_key_id AND c.turn_id = p.turn_id
      ) turns
      GROUP BY api_key_id ORDER BY tokens DESC LIMIT 20
    ` : sql`
      SELECT api_key_id as "apiKeyId", COUNT(*) as requests,
        COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens,
        COALESCE(SUM(sum_delta) * ${tmInput}, 0) as "promptTokens",
        COALESCE(SUM(sum_bill) * ${tmInput}, 0) as "billablePromptTokens",
        COALESCE(SUM(sum_cache) * ${tmInput}, 0) as "cachedTokens",
        COALESCE(SUM(sum_c) * ${tmOutput}, 0) as "completionTokens"
      FROM (SELECT api_key_id, turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta,
        SUM(COALESCE(prompt_tokens, 0)) as sum_bill,
        SUM(COALESCE(cached_tokens, 0)) as sum_cache,
        SUM(completion_tokens) as sum_c
        FROM request_logs WHERE created_at >= ${since} AND turn_id IS NOT NULL AND status_code BETWEEN 200 AND 299 AND is_billable_token = true
        GROUP BY api_key_id, turn_id)
      GROUP BY api_key_id ORDER BY tokens DESC LIMIT 20
    `)).rows;

    const result = [];
    for (const row of rows as any[]) {
      if (!row.apiKeyId) continue;
      const [key] = await db.select({ discordUserId: apiKeys.discordUserId, discordUsername: apiKeys.discordUsername, name: apiKeys.name, isTrial: apiKeys.isTrial })
        .from(apiKeys).where(eq(apiKeys.id, row.apiKeyId));
      if (!key) continue;

      if (key.isTrial) {
        const whereClause = and(eq(requestLogs.apiKeyId, row.apiKeyId), sql`created_at >= ${since}`, BILLABLE_LOG_SQL);
        const [raw] = await db.select({
          tokens: turnTotalTokensSql(whereClause, { isTrial: true }),
          promptTokens: turnPromptTokensSql(whereClause, { isTrial: true }),
          billablePromptTokens: turnBillablePromptTokensSql(whereClause, { isTrial: true }),
          cachedTokens: turnCachedTokensSql(whereClause, { isTrial: true }),
          completionTokens: turnCompletionTokensSql(whereClause, { isTrial: true }),
        }).from(requestLogs).where(whereClause);
        row.tokens = raw?.tokens ?? row.tokens;
        row.promptTokens = raw?.promptTokens ?? row.promptTokens;
        row.billablePromptTokens = raw?.billablePromptTokens ?? row.billablePromptTokens;
        row.cachedTokens = raw?.cachedTokens ?? row.cachedTokens;
        row.completionTokens = raw?.completionTokens ?? row.completionTokens;
      }

        const estimatedCost = Math.round((row.promptTokens || 0) * 1.5 + (row.completionTokens || 0) * 6.0);

      result.push({
        discordUserId: key.discordUserId,
        discordUsername: key.discordUsername || key.name,
        keyName: key.name,
        isTrial: key.isTrial || false,
        requests: row.requests,
        tokens: row.tokens,
        promptTokens: row.promptTokens,
        billablePromptTokens: row.billablePromptTokens || 0,
        cachedTokens: row.cachedTokens || 0,
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
    getTopModelsByRequests(todayDate),
    getTopModelsByRequests(monthDate),
    getTopModelsByTokens(todayDate),
    getTopModelsByTokens(monthDate),
    getTopUsersByRequests(todayDate),
    getTopUsersByRequests(monthDate),
    getTopUsersByTokens(todayDate),
    getTopUsersByTokens(monthDate),
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
  const key = await findBestKeyForDiscordUser(discordUserId);
  if (!key) return c.json({ error: "User not found" }, 404);

  const tmOpts = key.isTrial ? { isTrial: true as const } : undefined;
  const { input: umInput, output: umOutput } = getTokenMultipliers(tmOpts);

  const keyId = key.id;
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);
  const monthWib = new Date(wibNow); monthWib.setUTCDate(1);
  const monthStart = new Date(monthWib.getTime() - wibOffset);
  const todayDate = todayStart;
  const monthDate = monthStart;

  async function getTopModels(since: Date) {
    const rows = (await db.execute(sql`
      SELECT model, COUNT(*) as requests, COALESCE(SUM(sum_delta * ${umInput} + sum_c * ${umOutput}), 0) as tokens
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${keyId} AND created_at >= ${since} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND api_key_id = ${keyId} AND created_at >= ${since} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
      )
      GROUP BY model ORDER BY tokens DESC LIMIT 3
    `)).rows;
    return rows as any[];
  }

  async function getPeriodStats(since: Date) {
    const whereClause = and(eq(requestLogs.apiKeyId, keyId), sql`created_at >= ${since}`, VALID_LOG_SQL);
    const s = (await db.select({
      requests: turnCountSql(whereClause),
      tokens: turnTotalTokensSql(whereClause, tmOpts),
      promptTokens: turnPromptTokensSql(whereClause, tmOpts),
      billablePromptTokens: turnBillablePromptTokensSql(whereClause, tmOpts),
      cachedTokens: turnCachedTokensSql(whereClause, tmOpts),
      completionTokens: turnCompletionTokensSql(whereClause, tmOpts),
      contextTokens: sql<number>`0`,
    })
    .from(requestLogs)
    .where(whereClause))[0];

    // Cost derived from scaled per-model token split so it stays consistent.
    const breakdown = sanitizeRows((await db.execute(sql`
      SELECT model, COALESCE(SUM(sum_delta) * ${umInput}, 0) as "promptTokens", COALESCE(SUM(sum_c) * ${umOutput}, 0) as "completionTokens"
      FROM (SELECT model, turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${keyId} AND created_at >= ${since} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY model, turn_id)
      GROUP BY model
    `)).rows as any[], ['promptTokens', 'completionTokens']);
    let estimatedCost = 0;
    for (const row of breakdown as any[]) {
      const rates = getModelRates(row.model || "");
      estimatedCost += row.promptTokens * rates.prompt + row.completionTokens * rates.completion;
    }

    return {
      requests: s?.requests || 0,
      tokens: s?.tokens || 0,
      promptTokens: s?.promptTokens || 0,
      billablePromptTokens: s?.billablePromptTokens || 0,
      cachedTokens: s?.cachedTokens || 0,
      completionTokens: s?.completionTokens || 0,
      contextTokens: s?.contextTokens || 0,
      estimatedCost: Math.round(estimatedCost),
    };
  }

  const [todayStats, monthStats, todayModels, monthModels] = await Promise.all([
    getPeriodStats(todayDate),
    getPeriodStats(monthDate),
    getTopModels(todayDate),
    getTopModels(monthDate),
  ]);

  const [config] = await db.select().from(adminConfig);

  const isTrialKey = key.isTrial;
  const { getActiveAddonsForUser, sumAddonDailyTokenBonus, parseModelDailyLimits, resolveAddonQuotaStack } = await import("../../utils/addons.js");
  const activeAddons = !isTrialKey
    ? await getActiveAddonsForUser({
        discordUserId: key.discordUserId,
        apiKeyId: key.id,
      })
    : [];
  const addonDailyBonus = sumAddonDailyTokenBonus(activeAddons);
  const bypassPerModelPrompts = activeAddons.length > 0;
  const { limit: globalLimit, window: globalWindow } = resolveKeyPromptLimit(key, config);
  let globalUsed = 0;
  let globalResetMins = 0;
  let promptResetAt: string | null = null;

  if (globalLimit > 0) {
    const plCheck = await checkPromptLimit(key.id, globalLimit, globalWindow);
    globalUsed = plCheck.used;
    const windowMs = parseRateLimitWindow(globalWindow);
    const resetMs = await getWindowResetMs(key.id, windowMs);
    globalResetMins = Math.ceil(resetMs / 60000);
    promptResetAt = resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null;
  }

  const { limit: apiCallLimit, window: apiCallLimitWindow } = resolveKeyApiCallLimit(key, config);
  let apiCallUsed = 0;
  let apiCallResetMins = 0;
  let apiCallResetAt: string | null = null;
  if (apiCallLimit > 0) {
    const acCheck = await checkApiCallLimit(key.id, apiCallLimit, apiCallLimitWindow);
    apiCallUsed = acCheck.used;
    const windowMs = parseRateLimitWindow(apiCallLimitWindow);
    const resetMs = await getApiCallWindowResetMs(key.id, windowMs);
    apiCallResetMins = Math.ceil(resetMs / 60000);
    apiCallResetAt = resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null;
  }

  const activeModelLimits = isTrialKey
    ? []
    : await db.select().from(modelLimits).where(eq(modelLimits.scope, 'global'));
  const perModelLimitFallback = isTrialKey
    ? 0
    : (key.perModelPromptLimit && key.perModelPromptLimit > 0 ? key.perModelPromptLimit : config?.globalPerModelPromptLimit || 0);
  const perModelWindowFallback = isTrialKey
    ? (key.promptLimitWindow || "5h")
    : (key.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "30m");

  let modelUsage = [];
  if (!bypassPerModelPrompts) {
  for (const tm of todayModels) {
    if (!tm.model) continue;
    const mlCheck = await checkModelPromptLimit(
      key.id,
      tm.model,
      isTrialKey ? 0 : (key.perModelPromptLimit || 0),
      isTrialKey ? null : (key.perModelPromptLimitWindow || null),
      isTrialKey ? 0 : (config?.globalPerModelPromptLimit || 0),
      isTrialKey ? "5h" : (config?.globalPerModelPromptLimitWindow || "30m")
    );
    const windowStr = isTrialKey
      ? globalWindow
      : (key.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "30m");
    const windowMs = parseRateLimitWindow(windowStr);
    const resetMs = await getWindowResetMs(key.id, windowMs, tm.model);
    modelUsage.push({
      model: tm.model,
      used: mlCheck.used,
      limit: isTrialKey ? 0 : mlCheck.effectiveLimit,
      resetMins: Math.ceil(resetMs / 60000),
      resetAt: resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null,
      window: windowStr
    });
  }
  }

  if (isTrialKey && config) {
    // Trial: show used models only (no per-model prompt caps by default)
  } else if (!bypassPerModelPrompts) {
  for (const am of activeModelLimits) {
    if (!modelUsage.find(m => m.model === am.model)) {
      modelUsage.push({
        model: am.model,
        used: 0,
        limit: am.promptLimit,
        resetMins: 0,
        resetAt: null,
        window: perModelWindowFallback
      });
    }
  }
  } else {
    modelUsage = [];
  }

  // Calculate daily and monthly token reset times
  const tomorrowWib = new Date(wibNow);
  tomorrowWib.setUTCDate(tomorrowWib.getUTCDate() + 1);
  tomorrowWib.setUTCHours(0, 0, 0, 0);
  const dailyResetAt = new Date(tomorrowWib.getTime() - wibOffset).toISOString();

  const nextMonthWib = new Date(wibNow);
  nextMonthWib.setUTCMonth(nextMonthWib.getUTCMonth() + 1);
  nextMonthWib.setUTCDate(1);
  nextMonthWib.setUTCHours(0, 0, 0, 0);
  const monthlyResetAt = new Date(nextMonthWib.getTime() - wibOffset).toISOString();

  const trialRow = (await db.select().from(trialUsers).where(eq(trialUsers.apiKeyId, keyId)).limit(1))[0] || null;
  let trialInfo: Record<string, any> | null = null;
  if (trialRow || key.isTrial) {
    const now = new Date();
    const active = trialRow && !trialRow.endedAt && !trialRow.suspended && trialRow.expiresAt > now;
    trialInfo = {
      isTrial: true,
      status: trialRow?.suspended ? "suspended" : active ? "active" : (trialRow?.endedAt ? trialRow.endReason || "ended" : "expired"),
      expiresAt: trialRow?.expiresAt || null,
      endedAt: trialRow?.endedAt || null,
      endReason: trialRow?.endReason || null,
    };
  } else {
    trialInfo = { isTrial: false };
  }

  const baseDailyTokenLimit = resolveKeyDailyTokenLimit(key, config);
  const rawIn = key.isTrial ? 0 : ((key.dailyInputTokenLimit && key.dailyInputTokenLimit > 0) ? key.dailyInputTokenLimit : (config?.globalDailyInputTokenLimit || 0));
  const rawOut = key.isTrial ? 0 : ((key.dailyOutputTokenLimit && key.dailyOutputTokenLimit > 0) ? key.dailyOutputTokenLimit : (config?.globalDailyOutputTokenLimit || 0));
  const quotaStack = resolveAddonQuotaStack({
    hasActiveAddon: activeAddons.length > 0,
    keyOrGlobalDaily: baseDailyTokenLimit,
    dailyInput: rawIn,
    dailyOutput: rawOut,
    addonDailyBonus,
  });
  const effectiveDailyTokenLimit = quotaStack.effectiveDaily;

  const trialLimits = key.isTrial && config ? {
    dailyTokenLimit: effectiveDailyTokenLimit,
    promptLimit: globalLimit,
    promptLimitWindow: globalWindow,
    models: await listGpyCatalogModels(config),
    durationDays: config.trialDefaultDurationDays ?? 1,
    maxPerAccount: config.trialMaxPerAccount ?? 1,
  } : null;

  return c.json({
    discordUserId: key.discordUserId,
    discordUsername: key.discordUsername || key.name,
    isActive: key.isActive,
    isTrial: key.isTrial,
    trial: trialInfo,
    trialLimits,
    keyPrefix: key.keyPrefix,
    key: key.key,
    promptLimit: globalLimit,
    promptLimitWindow: globalWindow,
    promptUsed: globalUsed,
    promptResetMins: globalResetMins,
    promptResetAt,
    rateLimit: apiCallLimit,
    rateLimitWindow: apiCallLimitWindow,
    apiCallUsed,
    apiCallResetMins,
    apiCallResetAt,
    modelUsage,
    perModelPromptLimit: quotaStack.bypassPerModelPrompts ? 0 : perModelLimitFallback,
    perModelPromptLimitWindow: perModelWindowFallback,
    dailyTokenLimit: effectiveDailyTokenLimit,
    dailyTokenBreakdown: {
      base: quotaStack.baseDaily,
      addonBonus: quotaStack.addonBonus,
      effective: quotaStack.effectiveDaily,
      bypassIo: quotaStack.bypassIo,
    },
    activeAddons: activeAddons.map((a) => ({
      name: a.name,
      expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null,
      dailyTokenLimit: a.dailyTokenLimit || 0,
    })),
    addonModelTokenCaps: (() => {
      const out: Array<{ pattern: string; dailyLimit: number }> = [];
      const seen = new Set<string>();
      for (const a of activeAddons) {
        for (const [pattern, dailyLimit] of Object.entries(parseModelDailyLimits(a.modelDailyLimits))) {
          const key = `${pattern}:${dailyLimit}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ pattern, dailyLimit });
        }
      }
      return out;
    })(),
    perModelPromptsBypassedByAddon: quotaStack.bypassPerModelPrompts,
    monthlyTokenLimit: key.isTrial ? 0 : (config?.globalMonthlyTokenLimit || 0),
    dailyInputTokenLimit: quotaStack.dailyInputLimit,
    dailyOutputTokenLimit: quotaStack.dailyOutputLimit,
    dailyTokensUsed: todayStats?.tokens || 0,
    monthlyTokensUsed: monthStats?.tokens || 0,
    dailyInputUsed: todayStats?.promptTokens || 0,
    dailyOutputUsed: todayStats?.completionTokens || 0,
    dailyResetAt,
    monthlyResetAt,
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

internal.get("/internal/stats/user-detail/:discordUserId/model-overrides", async (c) => {
  const discordUserId = c.req.param("discordUserId");
  const key = await findKeyByDiscordUser(discordUserId);
  if (!key) return c.json({ error: "User not found" }, 404);

  const [config] = await db.select().from(adminConfig);
  const defaultWindow = key.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "30m";

  const [keyRows, globalRows] = await Promise.all([
    db.select().from(modelLimits).where(and(eq(modelLimits.scope, "key"), eq(modelLimits.scopeId, key.id))),
    db.select().from(modelLimits).where(and(eq(modelLimits.scope, "global"), eq(modelLimits.scopeId, 0))),
  ]);

  let catalogIds: string[] = [];
  try {
    const catalog = await getModelCatalogResponse();
    catalogIds = ((catalog as any)?.data || []).map((m: { id: string }) => m.id).filter(Boolean);
  } catch { /* catalog optional */ }

  // Cap matched sample IDs at 8 for the Discord embed (smaller surface)
  const enrich = (rows: typeof keyRows, scope: "key" | "global") =>
    rows.map((r) => {
      const pat = (r.model || "").toLowerCase();
      const matched = r.isPattern
        ? catalogIds.filter((id) => id.toLowerCase().includes(pat))
        : (catalogIds.some((id) => id === r.model) ? [r.model] : []);
      return {
        scope,
        model: r.model,
        isPattern: !!r.isPattern,
        promptLimit: r.promptLimit || 0,
        dailyTokenLimit: r.dailyTokenLimit || 0,
        monthlyTokenLimit: r.monthlyTokenLimit || 0,
        dailyInputTokenLimit: r.dailyInputTokenLimit || 0,
        dailyOutputTokenLimit: r.dailyOutputTokenLimit || 0,
        matchCount: matched.length,
        matchedSampleIds: matched.slice(0, 8),
      };
    });

  return c.json({
    keyId: key.id,
    discordUserId: key.discordUserId,
    defaultWindow,
    keyLimits: enrich(keyRows, "key"),
    globalLimits: enrich(globalRows, "global"),
  });
});

internal.get("/internal/providers", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const provs = await db.select().from(providers).where(eq(providers.isActive, true)).orderBy(providers.priority);
  return c.json(provs);
});

internal.get("/internal/pending-notifications", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const rows = await db
    .select({ id: apiKeys.id, pendingNotification: apiKeys.pendingNotification })
    .from(apiKeys);

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
  const activeKeys = await db.select().from(apiKeys).where(eq(apiKeys.isActive, true));
  const now = new Date();

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
      .where(eq(apiKeys.id, key.id));

    await db.delete(devices).where(eq(devices.apiKeyId, key.id));
    rotated += 1;
    if (key.discordUserId) notified += 1;
  }

  return c.json({ success: true, rotated, notified, endpoint });
});

internal.post("/internal/clear-notification/:keyId", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  await db.update(apiKeys)
    .set({ pendingNotification: null })
    .where(eq(apiKeys.id, keyId));
  return c.json({ success: true });
});

// --- Enriched Model Details (for Discord bot) --------------------------------
internal.get("/internal/models/details", async (c) => {
  const { getModelCatalogResponse, getClientCatalogMonitorRows } = await import("../../utils/model-catalog.js");

  const [catalog, monitorRows] = await Promise.all([
    getModelCatalogResponse(),
    getClientCatalogMonitorRows(),
  ]);

  const statusMap = new Map<string, { latencyMs: number; provider: string; clientOnline: boolean }>();
  for (const m of monitorRows) {
    statusMap.set(m.modelId, {
      latencyMs: m.latencyMs,
      provider: m.provider,
      clientOnline: m.clientOnline,
    });
    const bare = m.modelId.includes("/") ? m.modelId.slice(m.modelId.indexOf("/") + 1) : m.modelId;
    statusMap.set(`${m.provider}/${bare}`, {
      latencyMs: m.latencyMs,
      provider: m.provider,
      clientOnline: m.clientOnline,
    });
  }

  const enriched = catalog.data
    .map((model: any) => {
      const id = String(model.id || "");
      const monitor =
        statusMap.get(id) ||
        [...statusMap.entries()].find(
          ([mid]) => mid.endsWith("/" + id) || id.endsWith("/" + mid),
        )?.[1];
      if (!monitor) return null;
      return {
        ...model,
        is_online: monitor.clientOnline,
        latency_ms: monitor.latencyMs ?? null,
        active_provider: monitor.provider ?? null,
      };
    })
    .filter(Boolean);

  return c.json({ object: "list", data: enriched });
});

// --- Trial Mode (bot integration) --------------------------------------------
internal.get("/internal/trial-panel-config", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const { getTrialPanelConfigForBot } = await import("./trial.js");
  const config = await getTrialPanelConfigForBot();
  if (!config) return c.json({ error: "Admin config missing" }, 500);
  return c.json(config);
});

internal.post("/internal/trial-panel-message-id", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const body = await c.req.json<{ messageId?: string | null }>();
  const [config] = await db.select().from(adminConfig);
  if (!config) return c.json({ error: "Admin config missing" }, 500);
  await db.update(adminConfig).set({
    trialPanelMessageId: body.messageId || null,
    updatedAt: new Date(),
  }).where(eq(adminConfig.id, config.id));
  configCache.invalidate("admin_config");
  return c.json({ success: true });
});

internal.post("/internal/claim-trial", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const body = await c.req.json<{ discordUserId: string; discordUsername?: string; hasRequiredRole?: boolean }>();
  if (!body.discordUserId) return c.json({ error: "discordUserId required" }, 400);
  const { claimTrialForUser } = await import("./trial.js");
  const result = await claimTrialForUser(body);
  if ("error" in result && !("success" in result)) {
    return c.json(result, result.status || 400);
  }
  return c.json(result);
});

internal.get("/internal/trial-status/:discordUserId", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const { getTrialStatusForUser } = await import("./trial.js");
  return c.json(await getTrialStatusForUser(c.req.param("discordUserId")));
});

internal.post("/internal/admin-trial-action", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const body = await c.req.json<any>();
  const { adminTrialAction } = await import("./trial.js");
  const result = await adminTrialAction(body);
  if ("error" in result && !("success" in result)) {
    return c.json(result, result.status || 400);
  }
  return c.json(result);
});

internal.post("/internal/reset-all-trials", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const result = await resetAllTrials();
  return c.json({ success: true, ...result });
});

export async function resetAllTrials() {
  // 1. Kumpulkan semua trial apiKeyId
  const trialRows = await db.select().from(trialUsers);
  const trialKeyIds = trialRows.map((t) => t.apiKeyId);

  // 2. Clear notification queue
  for (const kid of trialKeyIds) {
    await db.update(apiKeys).set({ pendingNotification: null, updatedAt: new Date() }).where(eq(apiKeys.id, kid));
  }

  // 3. Delete request_logs & devices & allowed* untuk trial keys
  if (trialKeyIds.length > 0) {
    await db.delete(requestLogs).where(inArray(requestLogs.apiKeyId, trialKeyIds));
    await db.delete(devices).where(inArray(devices.apiKeyId, trialKeyIds));
    await db.delete(allowedDevices).where(inArray(allowedDevices.apiKeyId, trialKeyIds));
    await db.delete(allowedIdes).where(inArray(allowedIdes.apiKeyId, trialKeyIds));
    // 4. Delete trial keys
    await db.delete(apiKeys).where(inArray(apiKeys.id, trialKeyIds));
  }

  // 5. Delete trial users rows
  await db.delete(trialUsers);

  return { deleted: { trialUsers: trialRows.length, apiKeys: trialKeyIds.length } };
}

internal.get("/internal/trial-models", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const [config] = await db.select().from(adminConfig);
  if (!config) return c.json({ error: "Admin config missing" }, 500);
  const { listGpyCatalogModels } = await import("../../utils/trial-routing.js");
  const gpyModels = await listGpyCatalogModels(config);
  const mode =
    config.trialModelSelectionMode === "whitelist" ? "whitelist" : "all";
  return c.json({
    mode,
    whitelist: JSON.parse(config.trialModelWhitelist || "[]"),
    gpyModels,
  });
});

internal.post("/internal/run-auto-expire", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const { autoExpireAndNotify } = await import("../../utils/trial-scheduler.js");
  const result = await autoExpireAndNotify();
  return c.json({ success: true, ...result });
});

internal.get("/internal/audit", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  return c.json(auditSnapshot());
});

export async function auditSnapshot() {
  const checks: Array<{ name: string; status: 'ok' | 'fail' | 'warn'; detail: any }> = [];

  try {
    await db.execute(sql`SELECT 1 as ok`);
    checks.push({ name: 'database', status: 'ok', detail: { reachable: true } });
  } catch (err) {
    checks.push({ name: 'database', status: 'fail', detail: { error: (err as Error).message } });
  }

  try {
    const catalog = await getModelCatalogResponse();
    const all = (catalog?.data || []) as any[];
    const total = all.length;
    const gpy = all.filter((m) => String(m.id).toLowerCase().startsWith('gpy/')).length;
    checks.push({
      name: 'model_catalog',
      status: total > 0 ? 'ok' : 'warn',
      detail: { total, gpy, fetchedAt: catalog?.cached_at },
    });
  } catch (err) {
    checks.push({ name: 'model_catalog', status: 'fail', detail: { error: (err as Error).message } });
  }

  try {
    const [config] = await db.select().from(adminConfig);
    checks.push({
      name: 'trial_config',
      status: config?.trialEnabled ? 'ok' : 'warn',
      detail: {
        enabled: !!config?.trialEnabled,
        maxPerAccount: config?.trialMaxPerAccount,
        dailyTokenLimit: config?.trialDailyTokenLimit,
        promptLimit: config?.trialPromptLimit,
        modelSelectionMode: config?.trialModelSelectionMode,
      },
    });
  } catch (err) {
    checks.push({ name: 'trial_config', status: 'fail', detail: { error: (err as Error).message } });
  }

  try {
    const allTrials = await db.select().from(trialUsers);
    const now = new Date();
    const breakdown = { active: 0, suspended: 0, ended: 0, unclaimed: 0 };
    for (const t of allTrials) {
      if (t.endReason === 'admin_grant_retry') breakdown.unclaimed++;
      else if (t.endedAt) breakdown.ended++;
      else if (t.suspended) breakdown.suspended++;
      else if (t.expiresAt > now) breakdown.active++;
      else breakdown.ended++;
    }
    checks.push({ name: 'trial_users', status: 'ok', detail: { total: allTrials.length, breakdown } });
  } catch (err) {
    checks.push({ name: 'trial_users', status: 'fail', detail: { error: (err as Error).message } });
  }

  try {
    const allKeys = await db
      .select({ id: apiKeys.id, isTrial: apiKeys.isTrial, isActive: apiKeys.isActive })
      .from(apiKeys);
    const breakdown = { phantom: 0, phantom_disabled: 0, trial: 0, trial_disabled: 0 };
    for (const k of allKeys) {
      if (k.isTrial) (k.isActive ? breakdown.trial++ : breakdown.trial_disabled++);
      else (k.isActive ? breakdown.phantom++ : breakdown.phantom_disabled++);
    }
    checks.push({ name: 'api_keys', status: 'ok', detail: { total: allKeys.length, breakdown } });
  } catch (err) {
    checks.push({ name: 'api_keys', status: 'fail', detail: { error: (err as Error).message } });
  }

  const overall = checks.every((c) => c.status === 'ok')
    ? 'ok'
    : (checks.some((c) => c.status === 'fail') ? 'fail' : 'warn');
  return { overall, checks, timestamp: new Date().toISOString() };
}

internal.get("/internal/user-key-type/:discordUserId", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const discordUserId = c.req.param("discordUserId");

  // Get phantom key (non-trial, active)
  const [phantomKey] = await db
    .select({ id: apiKeys.id, isTrial: apiKeys.isTrial })
    .from(apiKeys)
    .where(and(eq(apiKeys.discordUserId, discordUserId), eq(apiKeys.isTrial, false), eq(apiKeys.isActive, true)))
    .limit(1);

  // Any active key (trial OR phantom) owned by this user
  const [anyActiveKey] = await db
    .select({ id: apiKeys.id, isTrial: apiKeys.isTrial })
    .from(apiKeys)
    .where(and(eq(apiKeys.discordUserId, discordUserId), eq(apiKeys.isActive, true)))
    .limit(1);

  return c.json({
    found: !!phantomKey || !!anyActiveKey,
    isTrial: phantomKey ? phantomKey.isTrial : (anyActiveKey ? anyActiveKey.isTrial : null),
    hasPhantomKey: !!phantomKey,
    hasActiveApiKey: !!anyActiveKey,
    isActive: phantomKey ? true : (anyActiveKey ? anyActiveKey.isTrial === false : false),
    discordUserId,
  });
});

/** Token Saver settings for Discord Usage panel (mirror portal). */
internal.get("/internal/token-saver/:discordUserId", async (c) => {
  const err = checkInternal(c);
  if (err) return err;
  const discordUserId = c.req.param("discordUserId");
  if (!discordUserId) return c.json({ error: "discordUserId required" }, 400);

  const [config] = await db.select().from(adminConfig).limit(1);
  const [settings] = await db
    .select()
    .from(userPortalSettings)
    .where(eq(userPortalSettings.discordUserId, discordUserId))
    .limit(1);

  return c.json({
    discordUserId,
    global: {
      rtk: config?.tokenSaverRtkEnabled ?? true,
      rtkMaxChars: config?.tokenSaverRtkMaxChars ?? 2000,
      headroom: config?.tokenSaverHeadroomEnabled ?? false,
      caveman: config?.tokenSaverCavemanEnabled ?? false,
      cavemanLevel: config?.tokenSaverCavemanLevel ?? 2,
      ponytail: config?.tokenSaverPonytailEnabled ?? false,
      ponytailLevel: config?.tokenSaverPonytailLevel || "lite",
    },
    overrides: {
      rtk: settings?.tokenSaverRtkOverride ?? null,
      headroom: settings?.tokenSaverHeadroomOverride ?? null,
      caveman: settings?.tokenSaverCavemanOverride ?? null,
      ponytail: settings?.tokenSaverPonytailOverride ?? null,
    },
  });
});

internal.put("/internal/token-saver/:discordUserId", async (c) => {
  const err = checkInternal(c);
  if (err) return err;
  const discordUserId = c.req.param("discordUserId");
  if (!discordUserId) return c.json({ error: "discordUserId required" }, 400);

  const body = await c.req.json<{
    rtk?: boolean | null;
    headroom?: boolean | null;
    caveman?: boolean | null;
    ponytail?: boolean | null;
  }>().catch(() => ({} as any));

  const normalize = (v: unknown): boolean | null => {
    if (v === null || v === undefined || v === "default") return null;
    if (v === true || v === "true" || v === "on") return true;
    if (v === false || v === "false" || v === "off") return false;
    return null;
  };

  const updates: Partial<typeof userPortalSettings.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.rtk !== undefined) updates.tokenSaverRtkOverride = normalize(body.rtk);
  if (body.headroom !== undefined) updates.tokenSaverHeadroomOverride = normalize(body.headroom);
  if (body.caveman !== undefined) updates.tokenSaverCavemanOverride = normalize(body.caveman);
  if (body.ponytail !== undefined) updates.tokenSaverPonytailOverride = normalize(body.ponytail);

  const [existing] = await db
    .select()
    .from(userPortalSettings)
    .where(eq(userPortalSettings.discordUserId, discordUserId))
    .limit(1);

  if (existing) {
    await db
      .update(userPortalSettings)
      .set(updates)
      .where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({
      discordUserId,
      tokenSaverRtkOverride: updates.tokenSaverRtkOverride ?? null,
      tokenSaverHeadroomOverride: updates.tokenSaverHeadroomOverride ?? null,
      tokenSaverCavemanOverride: updates.tokenSaverCavemanOverride ?? null,
      tokenSaverPonytailOverride: updates.tokenSaverPonytailOverride ?? null,
    });
  }

  const [refreshed] = await db
    .select()
    .from(userPortalSettings)
    .where(eq(userPortalSettings.discordUserId, discordUserId))
    .limit(1);

  return c.json({
    success: true,
    overrides: {
      rtk: refreshed?.tokenSaverRtkOverride ?? null,
      headroom: refreshed?.tokenSaverHeadroomOverride ?? null,
      caveman: refreshed?.tokenSaverCavemanOverride ?? null,
      ponytail: refreshed?.tokenSaverPonytailOverride ?? null,
    },
  });
});

/** Diagnose combo-gateway model routing (e.g. tokito/gpy/webnet 502s). */
internal.post("/internal/ops/probe-upstream-model", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const body = await c.req.json<{ model?: string; providerName?: string }>().catch(() => ({} as any));
  const model = String(body.model || "gpy/webnet/claude-haiku-4.5").trim();
  const providerName = String(body.providerName || "tokito").trim();

  const [prov] = await db.select().from(providers).where(eq(providers.name, providerName));
  if (!prov) return c.json({ error: `Provider ${providerName} not found` }, 404);

  const endpoint = prov.endpoint.replace(/\/$/, "");
  const url = `${endpoint}/chat/completions`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${prov.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
    });
    const text = await res.text();
    return c.json({
      success: true,
      provider: providerName,
      endpoint,
      model,
      status: res.status,
      latencyMs: Date.now() - t0,
      bodyPreview: text.slice(0, 400),
      hint: /no active credentials/i.test(text)
        ? "Enable credentials for that nested provider on the combo gateway (api3/9Router)."
        : null,
    });
  } catch (err: any) {
    return c.json({
      success: false,
      provider: providerName,
      model,
      latencyMs: Date.now() - t0,
      error: err?.message || String(err),
    }, 500);
  }
});

export default internal;