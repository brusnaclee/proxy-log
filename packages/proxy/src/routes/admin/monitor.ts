import { Hono } from "hono";
import { db } from "../../db/index.js";
import { modelMonitor } from "../../db/schema.js";
import { eq, sql, desc, max } from "drizzle-orm";
import { isInternalRequest, isAuthenticated } from "../../middleware/session.js";
import { adminConfig } from "../../db/schema.js";

const monitor = new Hono();

// Auth helper for bot pushing stats
const checkInternal = (c: any) => {
  if (!isInternalRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
};

const checkAdminSession = (c: any) => {
  if (!isAuthenticated(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
};

// Also export the base /monitor/models route that the bot hits (bot hits /admin/internal/monitor/models)
monitor.post("/internal/monitor/models", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const body = await c.req.json<any[]>();
  if (!Array.isArray(body)) return c.json({ error: "Expected array of monitor data" }, 400);

  const now = new Date().toISOString().replace("T", " ").substring(0, 19);
  
  const values = body.map(item => ({
    modelId: String(item.modelId),
    provider: item.provider ? String(item.provider) : null,
    isOnline: Boolean(item.isOnline),
    latencyMs: Number(item.latencyMs) || 0,
    httpStatus: Number(item.httpStatus) || 0,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    baseUrl: item.baseUrl ? String(item.baseUrl) : null,
    checkedAt: now,
  }));

  if (values.length > 0) {
    // Sqlite max vars limit is usually 999 or 32766, chunking if huge might be needed, but usually we send <100 models
    await db.insert(modelMonitor).values(values).run();
  }

  return c.json({ success: true, count: values.length });
});

// GET latest status per model
monitor.get("/settings/bot", async (c) => {
  const authErr = checkAdminSession(c);
  if (authErr) return authErr;
  
  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin config not found" }, 500);

  return c.json({
    discordBotToken: config.discordBotToken || "",
    agverifChannelId: config.agverifChannelId || "",
    tokitoChannelId: config.tokitoChannelId || "",
    requiredRoleId: config.requiredRoleId || "",
    ownerGroupyRoleId: config.ownerGroupyRoleId || "",
    verifiedRoleId: config.verifiedRoleId || "",
    geminiApiKey: config.geminiApiKey || "",
    verifAutoEnabled: Boolean(config.verifAutoEnabled),
    tokitoApiKey: config.tokitoApiKey || "",
  });
});

monitor.post("/settings/bot", async (c) => {
  const authErr = checkAdminSession(c);
  if (authErr) return authErr;
  
  const body = await c.req.json();
  const config = await db.select().from(adminConfig).get();
  if (!config) return c.json({ error: "Admin config not found" }, 500);

  const updates: Record<string, any> = {
    updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
  };

  if (body.discordBotToken !== undefined) updates.discordBotToken = body.discordBotToken;
  if (body.agverifChannelId !== undefined) updates.agverifChannelId = body.agverifChannelId;
  if (body.tokitoChannelId !== undefined) updates.tokitoChannelId = body.tokitoChannelId;
  if (body.requiredRoleId !== undefined) updates.requiredRoleId = body.requiredRoleId;
  if (body.ownerGroupyRoleId !== undefined) updates.ownerGroupyRoleId = body.ownerGroupyRoleId;
  if (body.verifiedRoleId !== undefined) updates.verifiedRoleId = body.verifiedRoleId;
  if (body.geminiApiKey !== undefined) updates.geminiApiKey = body.geminiApiKey;
  if (body.verifAutoEnabled !== undefined) updates.verifAutoEnabled = Boolean(body.verifAutoEnabled);
  if (body.tokitoApiKey !== undefined) updates.tokitoApiKey = body.tokitoApiKey;

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id)).run();

  return c.json({ success: true });
});

monitor.get("/monitor/models", async (c) => {
  // Query to get the latest entry for each model
  // SQLite doesn't have DISTINCT ON, so we use a subquery to get max checked_at per model
  const latestSubquery = db
    .select({
      modelId: modelMonitor.modelId,
      maxCheckedAt: sql<string>`MAX(checked_at)`.as('max_checked_at'),
    })
    .from(modelMonitor)
    .groupBy(modelMonitor.modelId)
    .as('latest');

  const rows = await db
    .select()
    .from(modelMonitor)
    .innerJoin(
      latestSubquery,
      sql`${modelMonitor.modelId} = ${latestSubquery.modelId} AND ${modelMonitor.checkedAt} = ${latestSubquery.maxCheckedAt}`
    )
    .orderBy(modelMonitor.modelId)
    .all();

  const data = rows.map(r => r.model_monitor);

  const summary = {
    total: data.length,
    online: data.filter(d => d.isOnline).length,
    offline: data.filter(d => !d.isOnline && d.httpStatus !== 0).length,
    timeout: data.filter(d => !d.isOnline && d.httpStatus === 0).length,
  };

  return c.json({ data, summary });
});

// GET history for a specific model
monitor.get("/monitor/models/:modelId/history", async (c) => {
  const modelId = c.req.param("modelId");
  const rows = await db
    .select()
    .from(modelMonitor)
    .where(eq(modelMonitor.modelId, modelId))
    .orderBy(desc(modelMonitor.checkedAt))
    .limit(100)
    .all();

  return c.json(rows);
});

// POST batch update from bot
monitor.post("/monitor/models", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const body = await c.req.json<any[]>();
  if (!Array.isArray(body)) return c.json({ error: "Expected array of monitor data" }, 400);

  const now = new Date().toISOString().replace("T", " ").substring(0, 19);
  
  const values = body.map(item => ({
    modelId: String(item.modelId),
    provider: item.provider ? String(item.provider) : null,
    isOnline: Boolean(item.isOnline),
    latencyMs: Number(item.latencyMs) || 0,
    httpStatus: Number(item.httpStatus) || 0,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    baseUrl: item.baseUrl ? String(item.baseUrl) : null,
    checkedAt: now,
  }));

  if (values.length > 0) {
    // Sqlite max vars limit is usually 999 or 32766, chunking if huge might be needed, but usually we send <100 models
    await db.insert(modelMonitor).values(values).run();
  }

  return c.json({ success: true, count: values.length });
});

// POST single update from bot
monitor.post("/monitor/models/single", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const item = await c.req.json<any>();
  if (!item.modelId) return c.json({ error: "modelId required" }, 400);

  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  await db.insert(modelMonitor).values({
    modelId: String(item.modelId),
    provider: item.provider ? String(item.provider) : null,
    isOnline: Boolean(item.isOnline),
    latencyMs: Number(item.latencyMs) || 0,
    httpStatus: Number(item.httpStatus) || 0,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    baseUrl: item.baseUrl ? String(item.baseUrl) : null,
    checkedAt: now,
  }).run();

  return c.json({ success: true });
});

export default monitor;