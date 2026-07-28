import { Hono } from "hono";
import { db } from "../../db/index.js";
import { adminConfig, apiKeys, requestLogs, chatSessions, devices, allowedDevices, allowedIdes, modelLimits } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { maskKey } from "../../utils/crypto.js";
import { refreshModelCatalog, getModelCatalogResponse } from "../../utils/model-catalog.js";
import { configCache, apiKeyCache, statsCache } from "../../utils/cache.js";
import { enrichModelLimitsWithCatalog } from "../../utils/model-limits-enrich.js";
import { normalizeTokenInputMode, normalizeTokenLimitWeightPercent, normalizeTokenLimitWeightMode, normalizeHopWeightRanges, serializeHopWeightRanges } from "../../utils/counting.js";
import { destroyAllAuthSessions } from "../../utils/auth-sessions.js";
import { destroySession } from "../../middleware/session.js";
import { authSessions } from "../../db/schema.js";
import {
  packGlobalTokenSaver,
  applyAdminTokenSaverUpdates,
} from "../../utils/token-saver-api.js";
import { listTeaseLimitRows, refreshTeaseLimitsCacheFromDb } from "../../utils/tease-limits-cache.js";

const settings = new Hono();

settings.get("/settings/global", async (c) => {
  const config = (await db.select().from(adminConfig))[0];
  if (!config) return c.json({ error: "Admin not configured" }, 500);
  return c.json({
    globalMaxDevices: config.globalMaxDevices || 0,
    realtimeEnabled: config.realtimeEnabled || false,
    globalRateLimit: config.globalRateLimit || 0,
    globalRateLimitWindow: config.globalRateLimitWindow || "5h",
    globalPromptLimit: config.globalPromptLimit || 0,
    globalPromptLimitWindow: config.globalPromptLimitWindow || "5h",
    globalPerModelPromptLimit: config.globalPerModelPromptLimit || 0,
    globalPerModelPromptLimitWindow: config.globalPerModelPromptLimitWindow || "1d",
    globalDailyTokenLimit: config.globalDailyTokenLimit || 0,
    globalMonthlyTokenLimit: config.globalMonthlyTokenLimit || 0,
    globalDailyInputTokenLimit: config.globalDailyInputTokenLimit || 0,
    globalDailyOutputTokenLimit: config.globalDailyOutputTokenLimit || 0,
    tokenInputMode: normalizeTokenInputMode((config as any).tokenInputMode),
    tokenLimitWeightPercent: normalizeTokenLimitWeightPercent((config as any).tokenLimitWeightPercent ?? 100),
    tokenLimitWeightMode: normalizeTokenLimitWeightMode((config as any).tokenLimitWeightMode),
    tokenLimitWeightCustom: normalizeHopWeightRanges((config as any).tokenLimitWeightCustom),
    addonRequiredModels: (() => {
      try {
        const parsed = JSON.parse((config as any).addonRequiredModels || "[]");
        return Array.isArray(parsed) ? parsed.map((x) => String(x || "").trim()).filter(Boolean) : [];
      } catch {
        return [];
      }
    })(),
    ...(() => {
      const ts = packGlobalTokenSaver(config);
      return {
        tokenSaverRtkEnabled: ts.rtk,
        tokenSaverRtkMaxChars: ts.rtkMaxChars,
        tokenSaverRtkMode: ts.rtkMode,
        tokenSaverRtkLevel: ts.rtkLevel,
        tokenSaverRtkCustom: ts.rtkCustom,
        tokenSaverHeadroomEnabled: ts.headroom,
        tokenSaverHeadroomUrl: ts.headroomUrl,
        tokenSaverHeadroomMode: ts.headroomMode,
        tokenSaverHeadroomLevel: ts.headroomLevel,
        tokenSaverHeadroomCustom: ts.headroomCustom,
        tokenSaverCavemanEnabled: ts.caveman,
        tokenSaverCavemanLevel: ts.cavemanLevel,
        tokenSaverCavemanMode: ts.cavemanMode,
        tokenSaverCavemanCustom: ts.cavemanCustom,
        tokenSaverPonytailEnabled: ts.ponytail,
        tokenSaverPonytailLevel: ts.ponytailLevel,
        tokenSaverPonytailMode: ts.ponytailMode,
        tokenSaverPonytailCustom: ts.ponytailCustom,
        tokenSaverGroupyCompactEnabled: ts.groupyCompact,
        tokenSaverGroupyCompactLevel: ts.groupyCompactLevel,
        tokenSaverGroupyCompactMode: ts.groupyCompactMode,
        tokenSaverGroupyCompactCustom: ts.groupyCompactCustom,
        tokenSaverBatchEnabled: ts.batch,
        tokenSaverBatchMode: ts.batchMode,
        tokenSaverBatchLevel: ts.batchLevel,
        tokenSaverBatchCustom: ts.batchCustom,
        tokenSaverAntiWasteEnabled: ts.antiWaste,
        tokenSaverAntiWasteMode: ts.antiWasteMode,
        tokenSaverAntiWasteLevel: ts.antiWasteLevel,
        tokenSaverAntiWasteCustom: ts.antiWasteCustom,
        tokenSaver: ts,
      };
    })(),
    teaseModelLimits: listTeaseLimitRows(),
  });
});

settings.put("/settings/global", async (c) => {
  const body = await c.req.json<any>();
  const config = (await db.select().from(adminConfig))[0];
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.globalMaxDevices !== undefined) updates.globalMaxDevices = body.globalMaxDevices;
  if (body.realtimeEnabled !== undefined) updates.realtimeEnabled = body.realtimeEnabled;
  if (body.globalRateLimit !== undefined) updates.globalRateLimit = body.globalRateLimit;
  if (body.globalRateLimitWindow !== undefined) updates.globalRateLimitWindow = body.globalRateLimitWindow || "5h";
  if (body.globalPromptLimit !== undefined) updates.globalPromptLimit = body.globalPromptLimit;
  if (body.globalPromptLimitWindow !== undefined) updates.globalPromptLimitWindow = body.globalPromptLimitWindow || "5h";
  if (body.globalPerModelPromptLimit !== undefined) updates.globalPerModelPromptLimit = body.globalPerModelPromptLimit;
  if (body.globalPerModelPromptLimitWindow !== undefined) updates.globalPerModelPromptLimitWindow = body.globalPerModelPromptLimitWindow || "1d";
  if (body.globalDailyTokenLimit !== undefined) updates.globalDailyTokenLimit = body.globalDailyTokenLimit;
    if (body.globalMonthlyTokenLimit !== undefined) updates.globalMonthlyTokenLimit = body.globalMonthlyTokenLimit;
    if (body.globalDailyInputTokenLimit !== undefined) updates.globalDailyInputTokenLimit = body.globalDailyInputTokenLimit;
    if (body.globalDailyOutputTokenLimit !== undefined) updates.globalDailyOutputTokenLimit = body.globalDailyOutputTokenLimit;
  if (body.tokenInputMode !== undefined) {
    updates.tokenInputMode = normalizeTokenInputMode(body.tokenInputMode);
  }
  if (body.tokenLimitWeightPercent !== undefined) {
    updates.tokenLimitWeightPercent = normalizeTokenLimitWeightPercent(body.tokenLimitWeightPercent);
  }
  if (body.tokenLimitWeightMode !== undefined) {
    updates.tokenLimitWeightMode = normalizeTokenLimitWeightMode(body.tokenLimitWeightMode);
  }
  if (body.tokenLimitWeightCustom !== undefined) {
    updates.tokenLimitWeightCustom = serializeHopWeightRanges(body.tokenLimitWeightCustom);
  }
  if (body.addonRequiredModels !== undefined) {
    const raw = body.addonRequiredModels;
    const list = Array.isArray(raw)
      ? raw.map((x: unknown) => String(x || "").trim()).filter(Boolean)
      : typeof raw === "string"
        ? (() => {
            try {
              const p = JSON.parse(raw);
              return Array.isArray(p) ? p.map((x) => String(x || "").trim()).filter(Boolean) : [];
            } catch {
              return String(raw)
                .split(/[,;\n]/)
                .map((s) => s.trim())
                .filter(Boolean);
            }
          })()
        : [];
    updates.addonRequiredModels = JSON.stringify(list);
  }
  applyAdminTokenSaverUpdates(body, updates);

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id));
  configCache.invalidate("admin_config"); // invalidate cached config
  if (
    updates.tokenInputMode !== undefined ||
    updates.tokenLimitWeightPercent !== undefined ||
    updates.tokenLimitWeightMode !== undefined ||
    updates.tokenLimitWeightCustom !== undefined
  ) {
    const { setTokenInputModeCache, setTokenLimitWeightConfigCache } = await import("../../utils/counting.js");
    if (updates.tokenInputMode !== undefined) setTokenInputModeCache(updates.tokenInputMode);
    setTokenLimitWeightConfigCache({
      mode: updates.tokenLimitWeightMode,
      percent: updates.tokenLimitWeightPercent,
      custom: updates.tokenLimitWeightCustom,
    });
    statsCache.clear(); // aggregates depend on input mode / weight
  }
  return c.json({ success: true, message: "Global settings updated" });
});

// Return available model list from catalog + model_monitor for dropdown selects
settings.get("/settings/models", async (c) => {
  const modelSet = new Set<string>();

  // From model catalog (upstream /v1/models cache)
  try {
    const catalog = await getModelCatalogResponse();
    for (const m of catalog.data || []) {
      if (m.id) modelSet.add(m.id);
    }
  } catch {}

  // From model_monitor table (models seen by Tokito bot)
  try {
    const monitors = await db.select({ modelId: sql<string>`DISTINCT model_id` })
      .from(sql`model_monitor`);
    for (const m of monitors) {
      if (m.modelId) modelSet.add(m.modelId);
    }
  } catch {}

  // From request_logs (models actually used)
  try {
    const used = await db.select({ model: sql<string>`DISTINCT model` })
      .from(sql`request_logs`);
    for (const m of used) {
      if (m.model && m.model !== "unknown") modelSet.add(m.model);
    }
  } catch {}

  const models = Array.from(modelSet).sort();
  return c.json({ data: models });
});

settings.get("/settings", async (c) => {
  const config = (await db.select().from(adminConfig))[0];
  if (!config) return c.json({ error: "Admin not configured" }, 500);
  return c.json({
    upstreamEndpoint: config.upstreamEndpoint,
    upstreamApiKey: config.upstreamApiKey ? maskKey(config.upstreamApiKey) : "",
    hasUpstreamKey: !!config.upstreamApiKey,
  });
});

settings.put("/settings", async (c) => {
  const body = await c.req.json<{ upstreamEndpoint?: string; upstreamApiKey?: string }>();
  const config = (await db.select().from(adminConfig))[0];
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.upstreamEndpoint !== undefined) updates.upstreamEndpoint = body.upstreamEndpoint.replace(/\/$/, "");
  if (body.upstreamApiKey !== undefined) updates.upstreamApiKey = body.upstreamApiKey;

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id));
  configCache.invalidate("admin_config"); // invalidate cached config

  // Immediately refresh cached model catalog when upstream settings change.
  if (body.upstreamEndpoint !== undefined || body.upstreamApiKey !== undefined) {
    void refreshModelCatalog();
  }

  return c.json({ success: true, message: "Settings updated" });
});

settings.put("/password", async (c) => {
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword: string; newPassword: string }>();
  if (!currentPassword || !newPassword) return c.json({ error: "Both current and new password are required" }, 400);
  if (newPassword.length < 6) return c.json({ error: "New password must be at least 6 characters" }, 400);

  const config = (await db.select().from(adminConfig))[0];
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const { verify, hash } = await import("@node-rs/argon2");
  const isValid = await verify(config.passwordHash, currentPassword);
  if (!isValid) return c.json({ error: "Current password is incorrect" }, 401);

  const newHash = await hash(newPassword);
  await db.update(adminConfig).set({
    passwordHash: newHash,
    updatedAt: new Date(),
  }).where(eq(adminConfig.id, config.id));

  await destroyAllAuthSessions("admin");
  await destroySession(c);

  return c.json({ success: true, message: "Password updated successfully" });
});

// ─── Global Model Limits CRUD ──────────────────────────────────────────────────

settings.get("/settings/model-limits", async (c) => {
  const rows = await db.select().from(modelLimits)
    .where(and(eq(modelLimits.scope, "global"), eq(modelLimits.scopeId, 0)));
  const data = await enrichModelLimitsWithCatalog(rows);
  return c.json({ data });
});

// GET /admin/settings/model-catalog/match?pattern=X
// Returns catalog model IDs that contain the (case-insensitive) substring.
// Used by the dashboard for the new pattern autocomplete preview.
settings.get("/settings/model-catalog/match", async (c) => {
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

settings.put("/settings/model-limits", async (c) => {
  const body = await c.req.json<{
    model: string;
    promptLimit?: number;
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
    dailyInputTokenLimit?: number;
    dailyOutputTokenLimit?: number;
    isPattern?: boolean;
    dedicatedQuota?: boolean;
  }>();
  if (!body.model || body.model.trim() === "") return c.json({ error: "model is required" }, 400);
  const modelName = body.model.trim();
  const isPattern = !!body.isPattern;
  const dedicatedQuota = !!body.dedicatedQuota;
  const limit = Math.max(0, body.promptLimit || 0);
  const dailyTokenLimit = Math.max(0, body.dailyTokenLimit || 0);
  const monthlyTokenLimit = Math.max(0, body.monthlyTokenLimit || 0);
  const dailyInputTokenLimit = Math.max(0, body.dailyInputTokenLimit || 0);
  const dailyOutputTokenLimit = Math.max(0, body.dailyOutputTokenLimit || 0);

  if (dedicatedQuota && dailyTokenLimit <= 0) {
    return c.json({ error: "dedicatedQuota requires dailyTokenLimit > 0" }, 400);
  }

  // Upsert via UPDATE (preserve prompt_window_start) or INSERT. Raw SQL avoids
  // a known Drizzle issue with the boolean is_pattern column on some pg clients.
  const { pool } = await import("../../db/index.js");
  const existing = await pool.query(
    `SELECT id, prompt_window_start FROM model_limits
     WHERE scope = $1 AND scope_id = $2 AND model = $3 AND is_pattern = $4 LIMIT 1`,
    ["global", 0, modelName, isPattern],
  );

  if (limit > 0 || dailyTokenLimit > 0 || monthlyTokenLimit > 0 || dailyInputTokenLimit > 0 || dailyOutputTokenLimit > 0) {
    if (existing.rows[0]?.id) {
      await pool.query(
        `UPDATE model_limits SET
           prompt_limit = $1,
           daily_token_limit = $2,
           monthly_token_limit = $3,
           daily_input_token_limit = $4,
           daily_output_token_limit = $5,
           dedicated_quota = $6
         WHERE id = $7`,
        [limit, dailyTokenLimit, monthlyTokenLimit, dailyInputTokenLimit, dailyOutputTokenLimit, dedicatedQuota, existing.rows[0].id],
      );
    } else {
      await db.insert(modelLimits).values({
        scope: "global", scopeId: 0, model: modelName, isPattern,
        promptLimit: limit,
        dailyTokenLimit,
        monthlyTokenLimit,
        dailyInputTokenLimit,
        dailyOutputTokenLimit,
        dedicatedQuota,
      });
    }
  } else if (existing.rows[0]?.id) {
    await pool.query(`DELETE FROM model_limits WHERE id = $1`, [existing.rows[0].id]);
  }

  await refreshTeaseLimitsCacheFromDb();

  return c.json({
    success: true, model: modelName, isPattern, dedicatedQuota,
    promptLimit: limit, dailyTokenLimit, monthlyTokenLimit, dailyInputTokenLimit, dailyOutputTokenLimit,
  });
});

settings.delete("/settings/model-limits/:model", async (c) => {
  const model = decodeURIComponent(c.req.param("model"));
  const isPatternRaw = c.req.query("isPattern");
  const { pool } = await import("../../db/index.js");
  if (isPatternRaw === "true" || isPatternRaw === "false") {
    await pool.query(
      `DELETE FROM model_limits WHERE scope = $1 AND scope_id = $2 AND model = $3 AND is_pattern = $4`,
      ["global", 0, model, isPatternRaw === "true"],
    );
  } else {
    await db.delete(modelLimits).where(and(
      eq(modelLimits.scope, "global"),
      eq(modelLimits.scopeId, 0),
      eq(modelLimits.model, model),
    ));
  }
  await refreshTeaseLimitsCacheFromDb();
  return c.json({ success: true, message: `Model limit for "${model}" removed` });
});

/**
 * POST /admin/settings/factory-reset
 * Resets ALL data to factory defaults:
 * - Deletes all API keys (and cascaded devices, policies)
 * - Deletes all request logs and chat sessions  
 * - Resets admin config to defaults (keeps password, clears upstream key/endpoint, resets limits)
 */
settings.post("/settings/factory-reset", async (c) => {
  try {
    const config = (await db.select().from(adminConfig))[0];
    if (!config) return c.json({ error: "Admin not configured" }, 500);

    // Delete all data
    await db.delete(requestLogs);
    await db.delete(chatSessions);
    await db.delete(allowedIdes);
    await db.delete(allowedDevices);
    await db.delete(devices);
    await db.delete(apiKeys);
    await db.delete(modelLimits);
    await db.delete(authSessions);

    // Reset admin config to defaults (keep password hash)
    await db.update(adminConfig).set({
      upstreamEndpoint: "https://api.openai.com",
      upstreamApiKey: "",
      globalMaxDevices: 0,
      realtimeEnabled: false,
      globalRateLimit: 500,
      globalRateLimitWindow: "5h",
      globalPromptLimit: 50,
      globalPromptLimitWindow: "5h",
      globalPerModelPromptLimit: 10,
      globalPerModelPromptLimitWindow: "5h",
      discordBotToken: "",
      agverifChannelId: "",
      tokitoChannelId: "",
      requiredRoleId: "",
      ownerGroupyRoleId: "",
      verifiedRoleId: "",
      geminiApiKey: "",
      verifAutoEnabled: false,
      tokitoApiKey: "",
      tokenSaverRtkEnabled: true,
      tokenSaverRtkMaxChars: 2000,
      tokenSaverHeadroomEnabled: false,
      tokenSaverHeadroomUrl: "",
      tokenSaverCavemanEnabled: false,
      tokenSaverCavemanLevel: 2,
      tokenSaverPonytailEnabled: false,
      tokenSaverPonytailLevel: "lite",
      updatedAt: new Date(),
    }).where(eq(adminConfig.id, config.id));

    configCache.clear();
    apiKeyCache.clear();

    return c.json({ success: true, message: "Factory reset complete. All API keys, logs, sessions, devices, and settings have been reset to defaults. Admin password preserved." });
  } catch (error: any) {
    return c.json({ error: "Factory reset failed", details: error.message }, 500);
  }
});

export default settings;
