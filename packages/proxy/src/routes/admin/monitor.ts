import { Hono } from "hono";
import { db } from "../../db/index.js";
import { modelMonitor } from "../../db/schema.js";
import { eq, sql, desc } from "drizzle-orm";
import { isInternalRequest, isAuthenticated } from "../../middleware/session.js";
import { adminConfig, providers, providerApiKeys } from "../../db/schema.js";
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

  const now = new Date();

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
  
  const [config] = await db.select().from(adminConfig);
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
  const [config] = await db.select().from(adminConfig);
  if (!config) return c.json({ error: "Admin config not found" }, 500);

  const updates: Record<string, any> = {
    updatedAt: new Date(),
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

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id));

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
    .orderBy(modelMonitor.provider, modelMonitor.modelId);

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
    .limit(100);

  return c.json(rows);
});

// POST batch update from bot
monitor.post("/monitor/models", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;

  const body = await c.req.json<any[]>();
  if (!Array.isArray(body)) return c.json({ error: "Expected array of monitor data" }, 400);

  const now = new Date();

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

  const now = new Date();

  await db.insert(modelMonitor).values({
    modelId: String(item.modelId),
    provider: item.provider ? String(item.provider) : null,
    isOnline: Boolean(item.isOnline),
    latencyMs: Number(item.latencyMs) || 0,
    httpStatus: Number(item.httpStatus) || 0,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    baseUrl: item.baseUrl ? String(item.baseUrl) : null,
    checkedAt: now,
  });

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
    .orderBy(modelMonitor.provider, modelMonitor.modelId);

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

// ─── Model Health Check Sweep ────────────────────────────────────────────────
let sweepRunning = false;
let sweepProgress = { total: 0, tested: 0, online: 0, offline: 0, rateLimited: 0, startedAt: "", status: "idle" as string };

monitor.post("/monitor/sweep", async (c) => {
  if (!isAuthenticated(c)) return c.json({ error: "Unauthorized" }, 401);
  if (sweepRunning) return c.json({ error: "Sweep already running", progress: sweepProgress });

  sweepRunning = true;
  sweepProgress = { total: 0, tested: 0, online: 0, offline: 0, rateLimited: 0, startedAt: new Date().toISOString(), status: "running" };

  (async () => {
    try {
      // Clear ALL old model_monitor rows before sweep to remove stale data
      await db.delete(modelMonitor);
      await resetAllTestStates();
      const activeProviders = await db.select().from(providers).where(eq(providers.isActive, true)).orderBy(sql`${providers.priority} DESC`);
      const allModels: Array<{ modelId: string; providerName: string; providerId: number; baseUrl: string; apiKey: string }> = [];

      for (const prov of activeProviders) {
        const keys = await db.select().from(providerApiKeys).where(sql`${providerApiKeys.providerId} = ${prov.id} AND ${providerApiKeys.isActive} = true AND ${providerApiKeys.isLimited} = false`).orderBy(providerApiKeys.id);
        if (keys.length === 0) continue;
        const urls = [`${prov.endpoint}/v1/models`, `${prov.endpoint}/models`];
        if (prov.endpoint.endsWith("/v1")) urls.unshift(`${prov.endpoint}/models`);
        for (const url of urls) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { headers: { "Authorization": `Bearer ${keys[0].apiKey}` }, signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) continue;
            const json = await res.json() as any;
            const models = Array.isArray(json?.data) ? json.data : [];
            if (models.length === 0) continue;
            for (const m of models) allModels.push({ modelId: m.id, providerName: prov.name, providerId: prov.id, baseUrl: prov.endpoint, apiKey: keys[0].apiKey });
            break;
          } catch { continue; }
        }
      }

      sweepProgress.total = allModels.length;
      for (const m of allModels) {
        let tested = false;
        const keys = await db.select().from(providerApiKeys).where(sql`${providerApiKeys.providerId} = ${m.providerId} AND ${providerApiKeys.isActive} = true AND ${providerApiKeys.isLimited} = false`).orderBy(providerApiKeys.id);
        for (const key of keys) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const start = Date.now();
            const res = await fetch(`${m.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key.apiKey}` }, body: JSON.stringify({ model: m.modelId, messages: [{ role: "user", content: "test" }], max_tokens: 1, temperature: 0 }), signal: controller.signal });
            clearTimeout(timeout);
            const ms = Date.now() - start;
            await upsertModelStatus({ modelId: m.modelId, provider: m.providerName, isOnline: res.ok, latencyMs: ms, httpStatus: res.status, errorMessage: res.ok ? null : `HTTP ${res.status}`, baseUrl: m.baseUrl });
            sweepProgress.tested++;
            if (res.ok) sweepProgress.online++; else if (res.status === 429) sweepProgress.rateLimited++; else sweepProgress.offline++;
            tested = true;
            break;
          } catch { continue; }
        }
        if (!tested) {
          await upsertModelStatus({ modelId: m.modelId, provider: m.providerName, isOnline: false, latencyMs: 0, httpStatus: 0, errorMessage: "Network error", baseUrl: m.baseUrl });
          sweepProgress.tested++;
          sweepProgress.offline++;
        }
        await new Promise(r => setTimeout(r, 200));
      }
      sweepProgress.status = "completed";
    } catch (err: any) { sweepProgress.status = "error"; console.error("[sweep] Error:", err.message); }
    finally { sweepRunning = false; }
  })();

  return c.json({ started: true, message: "Sweep started in background" });
});

monitor.get("/monitor/sweep/progress", async (c) => {
  if (!isAuthenticated(c)) return c.json({ error: "Unauthorized" }, 401);
  return c.json(sweepProgress);
});

export default monitor;