import { Hono } from "hono";
import { db } from "../../db/index.js";
import { adminConfig, apiKeys, requestLogs, chatSessions, devices, allowedDevices, allowedIdes, modelLimits } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { maskKey } from "../../utils/crypto.js";
import { refreshModelCatalog, getModelCatalogResponse } from "../../utils/model-catalog.js";

const settings = new Hono();

settings.get("/settings/global", async (c) => {
  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin not configured" }, 500);
  return c.json({
    globalMaxDevices: config.globalMaxDevices || 0,
    realtimeEnabled: config.realtimeEnabled || false,
    globalRateLimit: config.globalRateLimit || 0,
    globalRateLimitWindow: config.globalRateLimitWindow || "1h",
    globalPromptLimit: config.globalPromptLimit || 0,
    globalPromptLimitWindow: config.globalPromptLimitWindow || "1d",
    globalPerModelPromptLimit: config.globalPerModelPromptLimit || 0,
    globalPerModelPromptLimitWindow: config.globalPerModelPromptLimitWindow || "1d",
  });
});

settings.put("/settings/global", async (c) => {
  const body = await c.req.json<any>();
  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const updates: Record<string, any> = { updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) };
  if (body.globalMaxDevices !== undefined) updates.globalMaxDevices = body.globalMaxDevices;
  if (body.realtimeEnabled !== undefined) updates.realtimeEnabled = body.realtimeEnabled;
  if (body.globalRateLimit !== undefined) updates.globalRateLimit = body.globalRateLimit;
  if (body.globalRateLimitWindow !== undefined) updates.globalRateLimitWindow = body.globalRateLimitWindow || "1h";
  if (body.globalPromptLimit !== undefined) updates.globalPromptLimit = body.globalPromptLimit;
  if (body.globalPromptLimitWindow !== undefined) updates.globalPromptLimitWindow = body.globalPromptLimitWindow || "1d";
  if (body.globalPerModelPromptLimit !== undefined) updates.globalPerModelPromptLimit = body.globalPerModelPromptLimit;
  if (body.globalPerModelPromptLimitWindow !== undefined) updates.globalPerModelPromptLimitWindow = body.globalPerModelPromptLimitWindow || "1d";

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id)).run();
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
      .from(sql`model_monitor`)
      .all();
    for (const m of monitors) {
      if (m.modelId) modelSet.add(m.modelId);
    }
  } catch {}

  // From request_logs (models actually used)
  try {
    const used = await db.select({ model: sql<string>`DISTINCT model` })
      .from(sql`request_logs`)
      .all();
    for (const m of used) {
      if (m.model && m.model !== "unknown") modelSet.add(m.model);
    }
  } catch {}

  const models = Array.from(modelSet).sort();
  return c.json({ data: models });
});

settings.get("/settings", async (c) => {
  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin not configured" }, 500);
  return c.json({
    upstreamEndpoint: config.upstreamEndpoint,
    upstreamApiKey: config.upstreamApiKey ? maskKey(config.upstreamApiKey) : "",
    hasUpstreamKey: !!config.upstreamApiKey,
  });
});

settings.put("/settings", async (c) => {
  const body = await c.req.json<{ upstreamEndpoint?: string; upstreamApiKey?: string }>();
  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const updates: Record<string, any> = { updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) };
  if (body.upstreamEndpoint !== undefined) updates.upstreamEndpoint = body.upstreamEndpoint.replace(/\/$/, "");
  if (body.upstreamApiKey !== undefined) updates.upstreamApiKey = body.upstreamApiKey;

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id)).run();

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

  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const { verify, hash } = await import("@node-rs/argon2");
  const isValid = await verify(config.passwordHash, currentPassword);
  if (!isValid) return c.json({ error: "Current password is incorrect" }, 401);

  const newHash = await hash(newPassword);
  await db.update(adminConfig).set({
    passwordHash: newHash,
    updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
  }).where(eq(adminConfig.id, config.id)).run();

  return c.json({ success: true, message: "Password updated successfully" });
});

// ─── Global Model Limits CRUD ──────────────────────────────────────────────────

settings.get("/settings/model-limits", async (c) => {
  const rows = await db.select().from(modelLimits)
    .where(and(eq(modelLimits.scope, "global"), eq(modelLimits.scopeId, 0)))
    .all();
  return c.json({ data: rows });
});

settings.put("/settings/model-limits", async (c) => {
  const body = await c.req.json<{ model: string; promptLimit: number }>();
  if (!body.model || body.model.trim() === "") return c.json({ error: "model is required" }, 400);
  const modelName = body.model.trim();
  const limit = Math.max(0, body.promptLimit || 0);

  // Upsert: delete existing then insert
  await db.delete(modelLimits).where(and(
    eq(modelLimits.scope, "global"),
    eq(modelLimits.scopeId, 0),
    eq(modelLimits.model, modelName),
  )).run();

  if (limit > 0) {
    await db.insert(modelLimits).values({
      scope: "global", scopeId: 0, model: modelName, promptLimit: limit,
    }).run();
  }

  return c.json({ success: true, model: modelName, promptLimit: limit });
});

settings.delete("/settings/model-limits/:model", async (c) => {
  const model = decodeURIComponent(c.req.param("model"));
  await db.delete(modelLimits).where(and(
    eq(modelLimits.scope, "global"),
    eq(modelLimits.scopeId, 0),
    eq(modelLimits.model, model),
  )).run();
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
    const config = await db.select().from(adminConfig).get();
    if (!config) return c.json({ error: "Admin not configured" }, 500);

    // Delete all data
    await db.delete(requestLogs).run();
    await db.delete(chatSessions).run();
    await db.delete(allowedIdes).run();
    await db.delete(allowedDevices).run();
    await db.delete(devices).run();
    await db.delete(apiKeys).run();
    await db.delete(modelLimits).run();

    // Reset admin config to defaults (keep password hash)
    await db.update(adminConfig).set({
      upstreamEndpoint: "https://api.openai.com",
      upstreamApiKey: "",
      globalMaxDevices: 0,
      realtimeEnabled: false,
      globalRateLimit: 0,
      globalRateLimitWindow: "30m",
      globalPromptLimit: 50,
      globalPromptLimitWindow: "30m",
      globalPerModelPromptLimit: 10,
      globalPerModelPromptLimitWindow: "30m",
      discordBotToken: "",
      agverifChannelId: "",
      tokitoChannelId: "",
      requiredRoleId: "",
      ownerGroupyRoleId: "",
      verifiedRoleId: "",
      geminiApiKey: "",
      verifAutoEnabled: false,
      tokitoApiKey: "",
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
    }).where(eq(adminConfig.id, config.id)).run();

    return c.json({ success: true, message: "Factory reset complete. All API keys, logs, sessions, devices, and settings have been reset to defaults. Admin password preserved." });
  } catch (error: any) {
    return c.json({ error: "Factory reset failed", details: error.message }, 500);
  }
});

export default settings;
