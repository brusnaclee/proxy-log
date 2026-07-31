import { Hono } from "hono";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { adminConfig, addonAssignments, addons, allowedDevices, allowedIdes, apiKeys, devices, requestLogs, modelLimits, providers, trialUsers, userPortalSettings } from "../../db/schema.js";
import { generateApiKey, getKeyPrefix, sha256 } from "../../utils/crypto.js";
import { getModelRates } from "../../utils/cost-calculator.js";
import { normalizeIdeName } from "../../utils/detect-ide.js";
import {
  checkPromptLimit,
  checkModelPromptLimit,
  checkApiCallLimit,
  parseRateLimitWindow,
  getWindowResetMs,
  getApiCallWindowResetMs,
  listDedicatedQuotaRules,
  sqlExcludeDedicatedModels,
  sqlMatchDedicatedRule,
} from "../../utils/rate-limit.js";
import { isInternalRequest } from "../../middleware/session.js";
import { configCache } from "../../utils/cache.js";
import { BILLABLE_LOG_SQL, VALID_LOG_SQL, turnCountSql, turnPromptTokensSql, peakPromptTokensSql, turnCompletionTokensSql, turnBillablePromptTokensSql, turnCachedTokensSql, sanitizeRows, groupedInputSumSql, weightedHopInputTokensSql, weightedHopTotalTokensSql, modelLimitCreditBreakdownSql, normalizeTokenLimitWeightPercent } from "../../utils/counting.js";
import { getTokenMultipliers } from "../../utils/token-multiplier.js";
import {
  getAccountUsageAggregates,
  sortTopByRequests,
  sortTopByTokens,
} from "../../utils/account-usage-stats.js";
import { getModelCatalogResponse } from "../../utils/model-catalog.js";
import { resolveKeyPromptLimit, resolveKeyApiCallLimit } from "../../utils/trial-config.js";
import { listGpyCatalogModels } from "../../utils/trial-routing.js";
import { pickPrimaryNonTrialKey } from "../../utils/api-key-primary.js";

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
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  if (!keys.length) return undefined;
  return (
    pickPrimaryNonTrialKey(keys) ||
    keys.find((k) => k.isActive) ||
    keys[0]
  );
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

  const memberKey = pickPrimaryNonTrialKey(keys);
  if (memberKey) return memberKey;

  return keys[0];
}

async function getUserStats(apiKeyId: number) {
  const whereClause = and(eq(requestLogs.apiKeyId, apiKeyId), VALID_LOG_SQL);
  const [usage] = await db.select({
    requests: turnCountSql(whereClause),
    tokens: weightedHopTotalTokensSql(whereClause),
    promptTokens: weightedHopInputTokensSql(whereClause),
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
    // Never lower an admin/user-raised maxDevices back to global (was resetting to 1).
    const nextMax = Math.max(Number(existingPhantom.maxDevices) || 0, maxDevices);
    await db.update(apiKeys)
      .set({
        name: displayName,
        isActive: true,
        discordUsername: body.discordUsername || existingPhantom.discordUsername,
        maxDevices: nextMax,
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
    isTrial: !!k.isTrial,
    provisionedBy: k.provisionedBy || null,
    createdAt: k.createdAt,
  })));
});

internal.get("/internal/key-for-user/:userId", async (c) => {
  const userId = c.req.param("userId");
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, userId));

  // Same Primary as portal (admin-override > discord-bot > oldest non-trial)
  const primary = pickPrimaryNonTrialKey(keys);
  if (primary) {
    return c.json({
      apiKey: primary.key,
      keyPrefix: primary.keyPrefix,
      isActive: primary.isActive,
      isTrial: false,
      keyId: primary.id,
      provisionedBy: primary.provisionedBy,
      endpoint: `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`,
    });
  }

  // Fallback: active trial
  const anyKey = keys.find((k) => k.isActive) || keys[0];
  if (!anyKey) return c.json({ error: "No key found for user" }, 404);

  return c.json({
    apiKey: anyKey.key,
    keyPrefix: anyKey.keyPrefix,
    isActive: anyKey.isActive,
    isTrial: anyKey.isTrial,
    keyId: anyKey.id,
    provisionedBy: anyKey.provisionedBy,
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
    tokens: weightedHopTotalTokensSql(todayWhere),
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

  const [
    todayModelsByReq,
    monthModelsByReq,
    todayModelsByTok,
    monthModelsByTok,
    todayAccounts,
    monthAccounts,
  ] = await Promise.all([
    getTopModelsByRequests(todayDate),
    getTopModelsByRequests(monthDate),
    getTopModelsByTokens(todayDate),
    getTopModelsByTokens(monthDate),
    getAccountUsageAggregates(todayDate),
    getAccountUsageAggregates(monthDate),
  ]);

  return c.json({
    today: {
      topModelsByRequests: todayModelsByReq,
      topModelsByTokens: todayModelsByTok,
      topUsersByRequests: sortTopByRequests(todayAccounts),
      topUsersByTokens: sortTopByTokens(todayAccounts),
    },
    month: {
      topModelsByRequests: monthModelsByReq,
      topModelsByTokens: monthModelsByTok,
      topUsersByRequests: sortTopByRequests(monthAccounts),
      topUsersByTokens: sortTopByTokens(monthAccounts),
    },
  });
});

internal.get("/internal/stats/user-detail/:discordUserId", async (c) => {
  const discordUserId = c.req.param("discordUserId");
  const key = await findBestKeyForDiscordUser(discordUserId);
  if (!key) return c.json({ error: "User not found" }, 404);

  // Account-level tier (any non-trial key => member multipliers, even if that key
  // is inactive) so Discord, admin dashboard, portal and recap never disagree.
  const { resolveAccountTokenTier, accountTokenTierOpts } = await import("../../utils/account-token-tier.js");
  const tmOpts = accountTokenTierOpts((await resolveAccountTokenTier(discordUserId)).isTrial);
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

  // Account-scoped keys (shared pool) — fetch early for period stats
  const accountKeysEarly = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      provisionedBy: apiKeys.provisionedBy,
      isTrial: apiKeys.isTrial,
    })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  const accountKeyIds =
    accountKeysEarly.length > 0
      ? [key.id, ...accountKeysEarly.map((k) => k.id).filter((id) => id !== key.id)]
      : [key.id];
  const keyIdListSql = sql.join(accountKeyIds.map((id) => sql`${id}`), sql`, `);

  async function getTopModels(since: Date) {
    // Same limit-credit math as Hari Ini Total / Input — so model rows sum toward the period total.
    const rows = sanitizeRows(
      (
        await db.execute(
          modelLimitCreditBreakdownSql(
            sql`api_key_id IN (${keyIdListSql}) AND created_at >= ${since} AND status_code BETWEEN 200 AND 299`,
            { ...tmOpts, limit: 10 },
          ),
        )
      ).rows as any[],
      ["requests", "promptTokens", "completionTokens", "tokens"],
    );
    return rows;
  }

  async function getPeriodStats(since: Date, opts?: { excludeDedicated?: boolean }) {
    const dedicatedRules = opts?.excludeDedicated
      ? await listDedicatedQuotaRules(keyId)
      : [];
    const excludeDedicated = opts?.excludeDedicated
      ? sqlExcludeDedicatedModels(dedicatedRules)
      : undefined;
    const whereClause = and(
      inArray(requestLogs.apiKeyId, accountKeyIds),
      sql`created_at >= ${since}`,
      VALID_LOG_SQL,
      excludeDedicated,
    );
    const whereHops = and(
      inArray(requestLogs.apiKeyId, accountKeyIds),
      sql`created_at >= ${since}`,
      BILLABLE_LOG_SQL,
      excludeDedicated,
    );
    const s = (await db.select({
      requests: turnCountSql(whereClause!),
      tokens: weightedHopTotalTokensSql(whereHops!, tmOpts),
      promptTokens: weightedHopInputTokensSql(whereHops!, tmOpts),
      peakPromptTokens: peakPromptTokensSql(whereClause!, tmOpts),
      billablePromptTokens: turnBillablePromptTokensSql(whereClause!, tmOpts),
      cachedTokens: turnCachedTokensSql(whereClause!, tmOpts),
      completionTokens: turnCompletionTokensSql(whereClause!, tmOpts),
      contextTokens: sql<number>`0`,
    })
    .from(requestLogs)
    .where(whereClause!))[0];

    // Cost derived from scaled per-model token split so it stays consistent.
    const breakdown = sanitizeRows((await db.execute(sql`
      SELECT model, COALESCE(SUM(sum_delta) * ${umInput}, 0) as "promptTokens", COALESCE(SUM(sum_c) * ${umOutput}, 0) as "completionTokens"
      FROM (SELECT model, turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id IN (${keyIdListSql}) AND created_at >= ${since} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
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
      peakPromptTokens: s?.peakPromptTokens || 0,
      billablePromptTokens: s?.billablePromptTokens || 0,
      cachedTokens: s?.cachedTokens || 0,
      completionTokens: s?.completionTokens || 0,
      contextTokens: s?.contextTokens || 0,
      estimatedCost: Math.round(estimatedCost),
    };
  }

  const [todayStats, monthStats, todayModels, monthModels, todaySharedStats] = await Promise.all([
    getPeriodStats(todayDate),
    getPeriodStats(monthDate),
    getTopModels(todayDate),
    getTopModels(monthDate),
    getPeriodStats(todayDate, { excludeDedicated: true }),
  ]);

  const dedicatedRulesForKey = await listDedicatedQuotaRules(keyId);
  const dedicatedPools = [];
  for (const rule of dedicatedRulesForKey) {
    const wherePool = and(
      inArray(requestLogs.apiKeyId, accountKeyIds),
      sql`created_at >= ${todayDate}`,
      BILLABLE_LOG_SQL,
      sqlMatchDedicatedRule(rule),
    )!;
    const usedRow = await db
      .select({
        total: weightedHopTotalTokensSql(wherePool, tmOpts),
        input: weightedHopInputTokensSql(wherePool, tmOpts),
        output: turnCompletionTokensSql(wherePool, tmOpts),
      })
      .from(requestLogs)
      .where(wherePool)
      .then((r) => r[0]);
    const used = Number(usedRow?.total) || 0;
    const limit = rule.dailyTokenLimit || 0;
    dedicatedPools.push({
      model: rule.model,
      isPattern: !!rule.isPattern,
      scope: rule.scope,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetAt: null as string | null,
      inputLimit: rule.dailyInputTokenLimit || 0,
      outputLimit: rule.dailyOutputTokenLimit || 0,
      inputUsed: Number(usedRow?.input) || 0,
      outputUsed: Number(usedRow?.output) || 0,
    });
  }

  // Per-key contribution today (when multi-key account)
  let keysToday: Array<{
    keyId: number;
    name: string;
    isPrimary: boolean;
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
  }> = [];
  if (accountKeyIds.length >= 2) {
    keysToday = await Promise.all(
      accountKeysEarly.map(async (ak) => {
        const whereClause = and(
          eq(requestLogs.apiKeyId, ak.id),
          sql`created_at >= ${todayDate}`,
          VALID_LOG_SQL,
        );
        const whereHops = and(
          eq(requestLogs.apiKeyId, ak.id),
          sql`created_at >= ${todayDate}`,
          BILLABLE_LOG_SQL,
        );
        const s = (
          await db
            .select({
              requests: turnCountSql(whereClause!),
              tokens: weightedHopTotalTokensSql(whereHops!, tmOpts),
              promptTokens: weightedHopInputTokensSql(whereHops!, tmOpts),
              completionTokens: turnCompletionTokensSql(whereHops!, tmOpts),
            })
            .from(requestLogs)
            .where(whereClause!)
        )[0];
        return {
          keyId: ak.id,
          name: ak.name || `key-${ak.id}`,
          isPrimary: ak.id === keyId || ak.provisionedBy === "discord",
          requests: Number(s?.requests) || 0,
          tokens: Number(s?.tokens) || 0,
          promptTokens: Number(s?.promptTokens) || 0,
          completionTokens: Number(s?.completionTokens) || 0,
        };
      }),
    );
    keysToday.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.requests - a.requests);
  }

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

  // Account-scoped prompt/API counts (same as portal / live-usage)
  const promptScopeIds = accountKeyIds;

  if (globalLimit > 0) {
    const plCheck = await checkPromptLimit(promptScopeIds, globalLimit, globalWindow, key.promptWindowStart);
    globalUsed = plCheck.used;
    globalResetMins = Math.ceil(plCheck.resetMs / 60000);
    promptResetAt = plCheck.resetMs > 0 ? new Date(Date.now() + plCheck.resetMs).toISOString() : null;
  }

  const { limit: apiCallLimit, window: apiCallLimitWindow } = resolveKeyApiCallLimit(key, config);
  let apiCallUsed = 0;
  let apiCallResetMins = 0;
  let apiCallResetAt: string | null = null;
  if (apiCallLimit > 0) {
    const acCheck = await checkApiCallLimit(promptScopeIds, apiCallLimit, apiCallLimitWindow, key.rateWindowStart);
    apiCallUsed = acCheck.used;
    apiCallResetMins = Math.ceil(acCheck.resetMs / 60000);
    apiCallResetAt = acCheck.resetMs > 0 ? new Date(Date.now() + acCheck.resetMs).toISOString() : null;
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
      promptScopeIds,
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
    const resetMs = await getWindowResetMs(promptScopeIds, windowMs, tm.model);
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

  const hasActiveAddon = activeAddons.length > 0;
  const quotaStack = resolveAddonQuotaStack({
    hasActiveAddon,
    isTrial: !!key.isTrial,
    roleLimitMode: (key as any).roleLimitMode,
    keyDailyInput: key.isTrial ? 0 : key.dailyInputTokenLimit,
    keyDailyOutput: key.isTrial ? 0 : key.dailyOutputTokenLimit,
    keyDailyTotal: key.dailyTokenLimit,
    globalDailyInput: config?.globalDailyInputTokenLimit,
    globalDailyOutput: config?.globalDailyOutputTokenLimit,
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

  const { emptyInputLimitBreakdown, fetchInputLimitBreakdown } = await import("../../utils/usage-input-breakdown.js");
  let inputBreakdown = emptyInputLimitBreakdown();
  try {
    const whereTodayHopsAccount = and(
      inArray(requestLogs.apiKeyId, promptScopeIds),
      sql`created_at >= ${todayDate}`,
      sql`status_code BETWEEN 200 AND 299`,
      sqlExcludeDedicatedModels(dedicatedRulesForKey),
    )!;
    inputBreakdown = await fetchInputLimitBreakdown(whereTodayHopsAccount);
  } catch (err) {
    console.warn("[user-detail] input breakdown failed:", (err as Error)?.message || err);
  }

  const portalSettings = key.discordUserId
    ? (
        await db
          .select({ preferredLang: userPortalSettings.preferredLang })
          .from(userPortalSettings)
          .where(eq(userPortalSettings.discordUserId, key.discordUserId))
          .limit(1)
      )[0]
    : null;
  const preferredLang =
    String(portalSettings?.preferredLang || "").toLowerCase() === "id" ? "id" : "en";

  const { formatInputLimitExplanation } = await import("../../utils/usage-input-breakdown.js");
  const inputExplanation = formatInputLimitExplanation(inputBreakdown, {
    lang: preferredLang,
    dailyLimit: quotaStack.dailyInputLimit,
  });

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
    hopWeightPercent: normalizeTokenLimitWeightPercent((config as any)?.tokenLimitWeightPercent ?? 100),
    hopWeightMode: String((config as any)?.tokenLimitWeightMode || "first_rest_flat"),
    globalDailyInputTokenLimit: config?.globalDailyInputTokenLimit || 0,
    globalDailyOutputTokenLimit: config?.globalDailyOutputTokenLimit || 0,
    rateLimit: apiCallLimit,
    rateLimitWindow: apiCallLimitWindow,
    apiCallUsed,
    apiCallResetMins,
    apiCallResetAt,
    preferredLang,
    inputBreakdown,
    inputExplanation,
    accountKeyCount: accountKeyIds.length,
    keysToday,
    modelUsage,
    perModelPromptLimit: quotaStack.bypassPerModelPrompts ? 0 : perModelLimitFallback,
    perModelPromptLimitWindow: perModelWindowFallback,
    dailyTokenLimit: effectiveDailyTokenLimit,
    dailyTokenBreakdown: {
      base: quotaStack.inputBase,
      addonBonus: quotaStack.addonBonus,
      effective: quotaStack.dailyInputLimit,
      bypassIo: false,
      inputBase: quotaStack.inputBase,
      outputBase: quotaStack.outputBase,
      dailyTotal: quotaStack.effectiveDaily,
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
    accountTier: (() => {
      const raw = String((key as any).accountTier || "").trim();
      if (raw && raw !== "none" && raw !== "admin_override") return raw;
      return key.isTrial ? "trial" : "phantom";
    })(),
    accountBadges: (() => {
      let badges: string[] = [];
      try {
        badges = JSON.parse((key as any).accountBadges || "[]");
        if (!Array.isArray(badges)) badges = [];
      } catch {
        badges = [];
      }
      badges = badges.filter((b) => b && b !== "admin_override" && b !== "none");
      if (hasActiveAddon && !badges.includes("addon")) badges.push("addon");
      if (key.isTrial && !badges.includes("trial")) badges.unshift("trial");
      return badges;
    })(),
    monthlyTokenLimit: key.isTrial ? 0 : (config?.globalMonthlyTokenLimit || 0),
    dailyInputTokenLimit: quotaStack.dailyInputLimit,
    dailyOutputTokenLimit: quotaStack.dailyOutputLimit,
    dailyTokensUsed: todaySharedStats?.tokens || 0,
    monthlyTokensUsed: monthStats?.tokens || 0,
    dailyInputUsed: todaySharedStats?.promptTokens || 0,
    dailyOutputUsed: todaySharedStats?.completionTokens || 0,
    dailyInputBillable: todaySharedStats?.billablePromptTokens || 0,
    dailyInputCached: todaySharedStats?.cachedTokens || 0,
    dedicatedPools: dedicatedPools.map((p) => ({ ...p, resetAt: dailyResetAt })),
    dailyResetAt,
    monthlyResetAt,
    today: {
      requests: todayStats?.requests || 0,
      tokens: todayStats?.tokens || 0,
      promptTokens: todayStats?.promptTokens || 0,
      billablePromptTokens: todayStats?.billablePromptTokens || 0,
      cachedTokens: todayStats?.cachedTokens || 0,
      peakPromptTokens: todayStats?.peakPromptTokens || 0,
      completionTokens: todayStats?.completionTokens || 0,
      contextTokens: todayStats?.contextTokens || 0,
      estimatedCost: todayStats?.estimatedCost || 0,
      topModels: todayModels,
      tokenAccountingNote:
        "Input/Total = limit credit (hop-weighted). Top Models use the same credit.",
    },
    month: {
      requests: monthStats?.requests || 0,
      tokens: monthStats?.tokens || 0,
      promptTokens: monthStats?.promptTokens || 0,
      billablePromptTokens: monthStats?.billablePromptTokens || 0,
      cachedTokens: monthStats?.cachedTokens || 0,
      peakPromptTokens: monthStats?.peakPromptTokens || 0,
      completionTokens: monthStats?.completionTokens || 0,
      contextTokens: monthStats?.contextTokens || 0,
      estimatedCost: monthStats?.estimatedCost || 0,
      topModels: monthModels,
      tokenAccountingNote:
        "Input/Total = limit credit (hop-weighted). Top Models use the same credit.",
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

  const notifications: any[] = [];
  for (const r of rows) {
    if (!r.pendingNotification) continue;
    try {
      const parsed = JSON.parse(r.pendingNotification);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") {
          notifications.push({ keyId: r.id, ...item });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return c.json({ notifications });
});

/** Pending add-on Discord role grant/revoke jobs for the bot. */
internal.get("/internal/addon-role-sync", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  // Soft-expire: mark expired active assignments for revoke + key lifecycle
  const now = new Date();
  const expired = await db
    .select({
      id: addonAssignments.id,
      discordUserId: addonAssignments.discordUserId,
      addonId: addonAssignments.addonId,
    })
    .from(addonAssignments)
    .where(
      and(
        eq(addonAssignments.isActive, true),
        sql`${addonAssignments.expiresAt} IS NOT NULL AND ${addonAssignments.expiresAt} <= ${now}`,
      ),
    );

  const expiredUsers: string[] = [];
  const { syncUserKeyAccessAfterAddonChange } = await import("../../utils/key-access-lifecycle.js");
  const { queueUserNotificationByDiscord } = await import("../../utils/user-notify.js");

  for (const row of expired) {
    const [addon] = await db.select().from(addons).where(eq(addons.id, row.addonId)).limit(1);
    await db
      .update(addonAssignments)
      .set({ isActive: false, roleSyncAction: "revoke" } as any)
      .where(eq(addonAssignments.id, row.id));

    if (row.discordUserId) {
      expiredUsers.push(row.discordUserId);
      await queueUserNotificationByDiscord(row.discordUserId, {
        type: "addon_expired",
        title: "⏰ Add-on Habis",
        message:
          `Add-on **${addon?.name || "pack"}** telah expired.\n` +
          `Jika Anda tidak punya role Phantom/Staff, API key akan dinonaktifkan otomatis.`,
      });
      await syncUserKeyAccessAfterAddonChange(
        row.discordUserId,
        `add-on expired: ${addon?.name || row.addonId}`,
      );
    }
  }

  const pending = await db
    .select({
      assignmentId: addonAssignments.id,
      discordUserId: addonAssignments.discordUserId,
      action: addonAssignments.roleSyncAction,
      discordRoleId: addons.discordRoleId,
      addonName: addons.name,
      isActive: addonAssignments.isActive,
    })
    .from(addonAssignments)
    .innerJoin(addons, eq(addonAssignments.addonId, addons.id))
    .where(
      and(
        sql`${addonAssignments.roleSyncAction} IS NOT NULL`,
        sql`${addonAssignments.discordUserId} IS NOT NULL`,
        sql`${addons.discordRoleId} IS NOT NULL AND ${addons.discordRoleId} != ''`,
      ),
    );

  return c.json({ jobs: pending, expiredUsers: [...new Set(expiredUsers)] });
});

internal.post("/internal/sync-user-access", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const body = await c.req.json<{
    discordUserId?: string;
    roleIds?: string[] | null;
    rolesKnown?: boolean;
    reason?: string;
  }>();
  if (!body.discordUserId) return c.json({ error: "discordUserId is required" }, 400);
  const { syncUserKeyAccess } = await import("../../utils/key-access-lifecycle.js");
  const result = await syncUserKeyAccess(body.discordUserId, {
    roleIds: body.roleIds,
    rolesKnown: body.rolesKnown,
    reason: body.reason,
  });
  return c.json({ success: true, ...result });
});

/** Bulk recover / daily-style sync for all Discord-linked keys (internal secret). */
internal.post("/internal/sync-all-key-access", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const body = await c.req.json<{ allowDisable?: boolean; reason?: string; wait?: boolean }>().catch(() => ({} as any));
  const { syncAllDiscordLinkedKeyRoles } = await import("../../utils/key-access-lifecycle.js");
  const run = async () => {
    const result = await syncAllDiscordLinkedKeyRoles({
      concurrency: 1,
      allowDisable: body?.allowDisable !== false,
      reason: body?.reason || "internal sync-all-key-access",
    });
    console.log("[key-access] internal sync-all-key-access:", result);
    return result;
  };
  // Default: background so proxy stays responsive (full sync can take minutes)
  if (body?.wait) {
    const result = await run();
    return c.json({ success: true, ...result });
  }
  void run().catch((err) =>
    console.warn("[key-access] background sync-all failed:", (err as Error)?.message || err),
  );
  return c.json({ success: true, started: true });
});

internal.post("/internal/addon-role-sync/:assignmentId/clear", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const assignmentId = parseInt(c.req.param("assignmentId"));
  if (!Number.isFinite(assignmentId)) return c.json({ error: "Invalid id" }, 400);
  await db
    .update(addonAssignments)
    .set({ roleSyncAction: null } as any)
    .where(eq(addonAssignments.id, assignmentId));
  return c.json({ success: true });
});

/** Queue Discord role grant for every active assignment that has a pack discordRoleId (backfill). */
internal.post("/internal/addon-role-backfill", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const now = new Date();
  const rows = await db
    .select({
      assignmentId: addonAssignments.id,
      discordUserId: addonAssignments.discordUserId,
      addonName: addons.name,
      discordRoleId: addons.discordRoleId,
    })
    .from(addonAssignments)
    .innerJoin(addons, eq(addonAssignments.addonId, addons.id))
    .where(
      and(
        eq(addonAssignments.isActive, true),
        eq(addons.isActive, true),
        sql`${addonAssignments.discordUserId} IS NOT NULL`,
        sql`${addons.discordRoleId} IS NOT NULL AND ${addons.discordRoleId} != ''`,
        or(isNull(addonAssignments.expiresAt), gt(addonAssignments.expiresAt, now)),
      ),
    );

  let queued = 0;
  for (const row of rows) {
    await db
      .update(addonAssignments)
      .set({ roleSyncAction: "grant" } as any)
      .where(eq(addonAssignments.id, row.assignmentId));
    queued += 1;
  }
  return c.json({ success: true, queued, jobs: rows });
});

/** Active add-on role IDs for a Discord user (guild rejoin re-grant). */
internal.get("/internal/addon-roles/:discordUserId", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const discordUserId = c.req.param("discordUserId");
  const now = new Date();
  const rows = await db
    .select({
      discordRoleId: addons.discordRoleId,
      addonName: addons.name,
    })
    .from(addonAssignments)
    .innerJoin(addons, eq(addonAssignments.addonId, addons.id))
    .where(
      and(
        eq(addonAssignments.discordUserId, discordUserId),
        eq(addonAssignments.isActive, true),
        eq(addons.isActive, true),
        or(isNull(addonAssignments.expiresAt), gt(addonAssignments.expiresAt, now)),
      ),
    );
  const roleIds = [
    ...new Set(
      rows
        .map((r) => String(r.discordRoleId || "").trim())
        .filter(Boolean),
    ),
  ];
  return c.json({ roleIds, addons: rows });
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
  const [row] = await db
    .select({ pendingNotification: apiKeys.pendingNotification })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1);
  if (!row?.pendingNotification) {
    return c.json({ success: true });
  }
  let queue: any[] = [];
  try {
    const parsed = JSON.parse(row.pendingNotification);
    queue = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    queue = [];
  }
  // Dequeue one (bot clears after each processed notification)
  queue.shift();
  await db
    .update(apiKeys)
    .set({
      pendingNotification: queue.length > 0 ? JSON.stringify(queue) : null,
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, keyId));
  return c.json({ success: true });
});

// --- Enriched Model Details (for Discord bot) --------------------------------
internal.get("/internal/models/details", async (c) => {
  const {
    getModelCatalogResponse,
    getAllClientCatalogMonitorRows,
    buildProviderStrictStatusLookup,
  } = await import("../../utils/model-catalog.js");

  const [catalog, monitorRows] = await Promise.all([
    getModelCatalogResponse(),
    getAllClientCatalogMonitorRows(),
  ]);
  const { lookup } = buildProviderStrictStatusLookup(monitorRows);

  const enriched = catalog.data
    .map((model: any) => {
      const id = String(model.id || "");
      const monitor = lookup(id);
      if (!monitor?.visible) return null;
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

  const keys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  const primary = pickPrimaryNonTrialKey(keys);
  const anyActiveKey = keys.find((k) => k.isActive) || null;

  return c.json({
    found: !!primary || !!anyActiveKey,
    isTrial: primary ? false : (anyActiveKey ? !!anyActiveKey.isTrial : null),
    hasPhantomKey: !!primary,
    hasActiveApiKey: !!anyActiveKey,
    isActive: primary ? !!primary.isActive : false,
    primaryKeyId: primary?.id ?? null,
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

  const { packGlobalTokenSaver, packUserTokenSaverOverrides } = await import("../../utils/token-saver-api.js");
  return c.json({
    discordUserId,
    global: packGlobalTokenSaver(config),
    overrides: packUserTokenSaverOverrides(settings),
  });
});

internal.put("/internal/token-saver/:discordUserId", async (c) => {
  const err = checkInternal(c);
  if (err) return err;
  const discordUserId = c.req.param("discordUserId");
  if (!discordUserId) return c.json({ error: "discordUserId required" }, 400);

  const body = await c.req.json<any>().catch(() => ({} as any));
  const { applyUserTokenSaverUpdates, packUserTokenSaverOverrides } = await import("../../utils/token-saver-api.js");

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  applyUserTokenSaverUpdates(body, updates);

  const [existing] = await db
    .select()
    .from(userPortalSettings)
    .where(eq(userPortalSettings.discordUserId, discordUserId))
    .limit(1);

  if (existing) {
    await db
      .update(userPortalSettings)
      .set(updates as any)
      .where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({
      discordUserId,
      ...(updates as any),
    });
  }

  const [refreshed] = await db
    .select()
    .from(userPortalSettings)
    .where(eq(userPortalSettings.discordUserId, discordUserId))
    .limit(1);

  return c.json({
    success: true,
    overrides: packUserTokenSaverOverrides(refreshed),
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