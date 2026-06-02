import { Hono } from "hono";
import { db } from "../../db/index.js";
import { modelMonitor } from "../../db/schema.js";
import { eq, sql, desc } from "drizzle-orm";
import { isInternalRequest, isAuthenticated } from "../../middleware/session.js";
import { adminConfig } from "../../db/schema.js";
import {
  getActiveProviderNames,
  monitorStaleCutoffIso,
  replaceModelMonitorSnapshot,
  upsertModelStatus,
  getModelTestStates,
  resetAllTestStates,
  type MonitorSnapshotRow,
} from "../../utils/model-monitor-store.js";

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

  const values: MonitorSnapshotRow[] = body.map((item) => ({
    modelId: String(item.modelId),
    provider: item.provider ? String(item.provider) : null,
    isOnline: Boolean(item.isOnline),
    latencyMs: Number(item.latencyMs) || 0,
    httpStatus: Number(item.httpStatus) || 0,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    baseUrl: item.baseUrl ? String(item.baseUrl) : null,
    checkedAt: now,
  }));

  const count = await replaceModelMonitorSnapshot(values);

  return c.json({ success: true, count });
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
  const activeNames = await getActiveProviderNames();

  const latestSubquery = db
    .select({
      modelId: modelMonitor.modelId,
      provider: modelMonitor.provider,
      maxCheckedAt: sql<string>`MAX(checked_at)`.as('max_checked_at'),
    })
    .from(modelMonitor)
    .groupBy(modelMonitor.modelId, modelMonitor.provider)
    .as('latest');

  const rows = await db
    .select()
    .from(modelMonitor)
    .innerJoin(
      latestSubquery,
      sql`${modelMonitor.modelId} = ${latestSubquery.modelId} AND COALESCE(${modelMonitor.provider}, '') = COALESCE(${latestSubquery.provider}, '') AND ${modelMonitor.checkedAt} = ${latestSubquery.maxCheckedAt}`
    )
    .orderBy(modelMonitor.provider, modelMonitor.modelId)
    .all();

  const data = rows
    .map((r) => r.model_monitor)
    .filter((d) => d.provider && activeNames.has(d.provider));

  const summary = {
    total: data.length,
    online: data.filter((d) => d.isOnline).length,
    offline: data.filter((d) => !d.isOnline && d.httpStatus !== 0).length,
    timeout: data.filter((d) => !d.isOnline && d.httpStatus === 0).length,
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

  const values: MonitorSnapshotRow[] = body.map((item) => ({
    modelId: String(item.modelId),
    provider: item.provider ? String(item.provider) : null,
    isOnline: Boolean(item.isOnline),
    latencyMs: Number(item.latencyMs) || 0,
    httpStatus: Number(item.httpStatus) || 0,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    baseUrl: item.baseUrl ? String(item.baseUrl) : null,
    checkedAt: now,
  }));

  const count = await replaceModelMonitorSnapshot(values);

  return c.json({ success: true, count });
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

// ─── Smart Retry Endpoints ──────────────────────────────────────────────────────

// PATCH single model status with retry tracking
monitor.patch("/internal/monitor/models/status", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const item = await c.req.json<any>();
  if (!item.modelId) return c.json({ error: "modelId required" }, 400);

  await upsertModelStatus({
    modelId: String(item.modelId),
    provider: item.provider ? String(item.provider) : null,
    isOnline: Boolean(item.isOnline),
    latencyMs: Number(item.latencyMs) || 0,
    httpStatus: Number(item.httpStatus) || 0,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    baseUrl: item.baseUrl ? String(item.baseUrl) : null,
  });

  return c.json({ success: true });
});

// GET all model test states (bot uses on startup to recover retry state)
monitor.get("/internal/monitor/models/state", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const states = await getModelTestStates();
  return c.json({ states });
});

// PATCH reset all test states (midnight reset)
monitor.patch("/internal/monitor/models/state/reset", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  await resetAllTestStates();
  return c.json({ success: true });
});

// GET internal model status (for bot to read fresh data from DB)
monitor.get("/internal/monitor/models", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const activeNames = await getActiveProviderNames();

  const latestSubquery = db
    .select({
      modelId: modelMonitor.modelId,
      provider: modelMonitor.provider,
      maxCheckedAt: sql<string>`MAX(checked_at)`.as('max_checked_at'),
    })
    .from(modelMonitor)
    .groupBy(modelMonitor.modelId, modelMonitor.provider)
    .as('latest');

  const rows = await db
    .select()
    .from(modelMonitor)
    .innerJoin(
      latestSubquery,
      sql`${modelMonitor.modelId} = ${latestSubquery.modelId} AND COALESCE(${modelMonitor.provider}, '') = COALESCE(${latestSubquery.provider}, '') AND ${modelMonitor.checkedAt} = ${latestSubquery.maxCheckedAt}`
    )
    .orderBy(modelMonitor.provider, modelMonitor.modelId)
    .all();

  const data = rows
    .map((r) => r.model_monitor)
    .filter((d) => d.provider && activeNames.has(d.provider));

  return c.json({ data });
});

// ─── Enriched Model Details (catalog + metadata + monitor status) ────────────
monitor.get("/monitor/models/details", async (c) => {
  const { getModelCatalogResponse, getOnlineModelsByLatency, getModelMetadataMap } = await import("../../utils/model-catalog.js");
  
  const [catalog, onlineModels] = await Promise.all([
    getModelCatalogResponse(),
    getOnlineModelsByLatency(),
  ]);

  const onlineMap = new Map<string, { latencyMs: number; provider: string }>();
  for (const m of onlineModels) {
    onlineMap.set(m.modelId, { latencyMs: m.latencyMs, provider: m.provider });
  }

  const enriched = catalog.data.map((model: any) => {
    const monitor = onlineMap.get(model.id);
    return {
      ...model,
      is_online: !!monitor,
      latency_ms: monitor?.latencyMs ?? null,
      active_provider: monitor?.provider ?? null,
    };
  });

  return c.json({ object: "list", data: enriched });
});

export default monitor;