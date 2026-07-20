import { Hono } from "hono";
import { db } from "../../db/index.js";
import { modelMonitor } from "../../db/schema.js";
import { eq, sql, desc } from "drizzle-orm";
import { isInternalRequest, isAuthenticated } from "../../middleware/session.js";
import { adminConfig, providers, providerApiKeys, customModels } from "../../db/schema.js";
import {
  getActiveProviderNames,
  monitorStaleCutoffIso,
  replaceModelMonitorSnapshot,
  upsertModelStatus,
  getModelTestStates,
  resetAllTestStates,
  getMonitorAutoMode,
  normalizeMonitorAutoMode,
  isForceDeactivatedMessage,
  isProbeOk,
  type MonitorSnapshotRow,
} from "../../utils/model-monitor-store.js";
import {
  isValidProbeBody,
  buildModelListAuthHeaders,
  buildModelListCandidateUrls,
  extractModelsArray,
} from "../../utils/probe-validate.js";

const monitor = new Hono();

function normalizeProviderBase(endpoint: string): string {
  return String(endpoint || "").trim().replace(/\/$/, "");
}

function buildProbeRequest(
  baseUrl: string,
  endpointType: string,
  modelId: string,
  apiKey: string,
): { url: string; init: RequestInit } {
  const base = normalizeProviderBase(baseUrl);
  if (endpointType === "anthropic") {
    const messagesUrl = base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
    return {
      url: messagesUrl,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 8,
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    };
  }

  const chatUrl = base.endsWith("/v1")
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;
  return {
    url: chatUrl,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "test" }],
          max_tokens: 8,
          temperature: 0,
          stream: false,
        }),
    },
  };
}

async function getProviderProbeKey(providerId: number, legacyApiKey: string | null): Promise<string | null> {
  const keys = await getProviderProbeKeys(providerId, legacyApiKey);
  return keys[0] || null;
}

/**
 * Probe keys MUST match the pool used for live user traffic (getNextApiKey).
 * Never use limited keys, and never fall back to legacy api_key when the
 * provider already has rows in provider_api_keys (that caused false-Online:
 * probe via legacy while traffic saw 0 usable keys → 502).
 */
async function getProviderProbeKeys(providerId: number, legacyApiKey: string | null): Promise<string[]> {
  const allActive = await db
    .select()
    .from(providerApiKeys)
    .where(sql`${providerApiKeys.providerId} = ${providerId} AND ${providerApiKeys.isActive} = true`)
    .orderBy(providerApiKeys.id);

  if (allActive.length > 0) {
    return allActive
      .filter((r) => !r.isLimited)
      .map((r) => r.apiKey)
      .filter(Boolean);
  }

  // True legacy mode: no rows in provider_api_keys at all.
  return legacyApiKey ? [legacyApiKey] : [];
}

const SWEEP_PROBE_TIMEOUT_MS = Number(process.env.SWEEP_PROBE_TIMEOUT_MS) || 180_000;
const SWEEP_PROBE_ATTEMPTS = Math.max(1, Number(process.env.SWEEP_PROBE_ATTEMPTS) || 3);

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
    monitorAutoMode: normalizeMonitorAutoMode(config.monitorAutoMode),
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
  if (body.monitorAutoMode !== undefined) {
    updates.monitorAutoMode = normalizeMonitorAutoMode(body.monitorAutoMode);
  }

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id));

  return c.json({ success: true, monitorAutoMode: updates.monitorAutoMode ?? normalizeMonitorAutoMode(config.monitorAutoMode) });
});

/** Bot reads auto mode to decide whether 10-min sweeps run / publish. */
monitor.get("/internal/monitor/auto-mode", async (c) => {
  const authErr = checkInternal(c);
  if (authErr) return authErr;
  const mode = await getMonitorAutoMode();
  return c.json({ mode });
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
    .filter((d) => d.provider && activeNames.has(d.provider))
    .map((d) => ({
      ...d,
      probeOk: isProbeOk(d.httpStatus),
      forceDeactivated: isForceDeactivatedMessage(d.errorMessage),
    }));

  const mode = await getMonitorAutoMode();
  const activeProviders = [...activeNames].sort((a, b) => a.localeCompare(b));
  const summary = {
    total: data.length,
    online: data.filter((d) => d.isOnline).length,
    offline: data.filter((d) => !d.isOnline && d.httpStatus !== 0).length,
    timeout: data.filter((d) => !d.isOnline && d.httpStatus === 0).length,
    probeOk: data.filter((d) => d.probeOk).length,
    monitorAutoMode: mode,
  };

  return c.json({ data, summary, monitorAutoMode: mode, activeProviders });
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
  }, { source: "sweep" });

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

function modelVendorOf(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[0] : "unknown";
}

async function getLatestMonitorRows() {
  const activeNames = await getActiveProviderNames();

  const latestSubquery = db
    .select({
      modelId: modelMonitor.modelId,
      provider: modelMonitor.provider,
      maxCheckedAt: sql<string>`MAX(checked_at)`.as("max_checked_at"),
    })
    .from(modelMonitor)
    .groupBy(modelMonitor.modelId, modelMonitor.provider)
    .as("latest");

  const rows = await db
    .select()
    .from(modelMonitor)
    .innerJoin(
      latestSubquery,
      sql`${modelMonitor.modelId} = ${latestSubquery.modelId} AND COALESCE(${modelMonitor.provider}, '') = COALESCE(${latestSubquery.provider}, '') AND ${modelMonitor.checkedAt} = ${latestSubquery.maxCheckedAt}`,
    )
    .orderBy(modelMonitor.provider, modelMonitor.modelId);

  return rows
    .map((r) => r.model_monitor)
    .filter((d) => d.provider && activeNames.has(d.provider));
}

// POST admin force-activate: publish model ON in Discord/client catalog.
// Sticky until admin OFF (sweeps in notif_only never flip published).
monitor.post("/monitor/models/activate", async (c) => {
  const authErr = checkAdminSession(c);
  if (authErr) return authErr;

  const body = await c.req.json<{ modelId: string; provider: string }>();
  if (!body.modelId || !body.provider) {
    return c.json({ error: "modelId and provider required" }, 400);
  }
  await upsertModelStatus(
    {
      modelId: String(body.modelId),
      provider: String(body.provider),
      isOnline: true,
      latencyMs: 0,
      httpStatus: 200,
      errorMessage: null,
      baseUrl: null,
    },
    { source: "admin" },
  );
  return c.json({ success: true, message: `${body.modelId} published ON` });
});

// POST admin force-deactivate: publish model OFF (sticky until admin ON).
monitor.post("/monitor/models/deactivate", async (c) => {
  const authErr = checkAdminSession(c);
  if (authErr) return authErr;

  const body = await c.req.json<{ modelId: string; provider: string }>();
  if (!body.modelId || !body.provider) {
    return c.json({ error: "modelId and provider required" }, 400);
  }
  await upsertModelStatus(
    {
      modelId: String(body.modelId),
      provider: String(body.provider),
      isOnline: false,
      latencyMs: 0,
      httpStatus: 503,
      errorMessage: "Force-deactivated by admin",
      baseUrl: null,
    },
    { source: "admin" },
  );
  return c.json({ success: true, message: `${body.modelId} published OFF` });
});

// POST bulk override: toggle published ON/OFF for matching models.
monitor.post("/monitor/models/bulk-override", async (c) => {
  const authErr = checkAdminSession(c);
  if (authErr) return authErr;

  const body = await c.req.json<{
    action: "on" | "off";
    provider?: string;
    vendor?: string;
    /** Filter by probe: ok = HTTP 2xx, fail = not 2xx / missing */
    probe?: "ok" | "fail" | "all";
  }>();
  if (body.action !== "on" && body.action !== "off") {
    return c.json({ error: 'action must be "on" or "off"' }, 400);
  }

  const providerFilter = body.provider && body.provider !== "all" ? String(body.provider) : null;
  const vendorFilter = body.vendor && body.vendor !== "all" ? String(body.vendor) : null;
  const probeFilter = body.probe === "ok" || body.probe === "fail" ? body.probe : "all";

  let rows = await getLatestMonitorRows();
  if (providerFilter) {
    rows = rows.filter((d) => d.provider === providerFilter);
  }
  if (vendorFilter) {
    rows = rows.filter((d) => modelVendorOf(d.modelId) === vendorFilter);
  }
  if (probeFilter === "ok") {
    rows = rows.filter((d) => Number(d.httpStatus) >= 200 && Number(d.httpStatus) < 300);
  } else if (probeFilter === "fail") {
    rows = rows.filter((d) => !(Number(d.httpStatus) >= 200 && Number(d.httpStatus) < 300));
  }

  if (rows.length === 0) {
    return c.json({ success: true, updated: 0, message: "No models matched the filter" });
  }

  const turnOn = body.action === "on";
  for (const row of rows) {
    await upsertModelStatus(
      {
        modelId: row.modelId,
        provider: row.provider,
        isOnline: turnOn,
        latencyMs: turnOn ? (row.latencyMs ?? 0) : 0,
        httpStatus: turnOn ? (row.httpStatus && row.httpStatus >= 200 && row.httpStatus < 300 ? row.httpStatus : 200) : 503,
        errorMessage: turnOn ? null : "Force-deactivated by admin (bulk)",
        baseUrl: row.baseUrl,
      },
      { source: "admin" },
    );
  }

  const scope = [
    providerFilter ? `upstream=${providerFilter}` : null,
    vendorFilter ? `vendor=${vendorFilter}` : null,
    probeFilter !== "all" ? `probe=${probeFilter}` : null,
  ].filter(Boolean).join(", ") || "all models";

  return c.json({
    success: true,
    updated: rows.length,
    message: `Published ${body.action.toUpperCase()} ${rows.length} model(s) (${scope})`,
  });
});

// ─── Enriched Model Details (catalog + metadata + monitor status) ────────────
monitor.get("/monitor/models/details", async (c) => {
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

/** Force re-fetch /models into Model Monitor for all active upstreams. */
monitor.post("/monitor/sync-catalog", async (c) => {
  if (!isAuthenticated(c)) return c.json({ error: "Unauthorized" }, 401);
  const { syncAllActiveProvidersToMonitor } = await import("../../utils/model-catalog.js");
  const result = await syncAllActiveProvidersToMonitor();
  return c.json({ success: true, ...result });
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
      // Snapshot previous rows so soft-retain can re-probe when /models list fails.
      const previousRows = await db.select().from(modelMonitor);
      // Clear ALL old model_monitor rows before sweep to remove stale data
      await db.delete(modelMonitor);
      await resetAllTestStates();
      const activeProviders = await db.select().from(providers).where(eq(providers.isActive, true)).orderBy(sql`${providers.priority} DESC`);
      const allModels: Array<{ modelId: string; providerName: string; providerId: number; baseUrl: string; apiKey: string; endpointType: string }> = [];

      for (const prov of activeProviders) {
        const probeKeys = await getProviderProbeKeys(prov.id, prov.apiKey);
        if (probeKeys.length === 0) {
          console.warn(
            `[monitor-sweep] ${prov.name}: no usable API keys — skip (do not retain stale models)`,
          );
          continue;
        }

        const endpointType = prov.endpointType || "openai";
        const urls = buildModelListCandidateUrls(prov.endpoint);
        let listed = false;

        outer: for (const url of urls) {
          for (const key of probeKeys) {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 10_000);
              const res = await fetch(url, {
                headers: buildModelListAuthHeaders(key, endpointType),
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (!res.ok) continue;
              const json = (await res.json()) as any;
              const models = extractModelsArray(json);
              if (models.length === 0) continue;
              for (const m of models) {
                const mid = String(m?.id || m?.name || "").trim();
                if (!mid) continue;
                allModels.push({
                  modelId: mid,
                  providerName: prov.name,
                  providerId: prov.id,
                  baseUrl: prov.endpoint,
                  apiKey: key,
                  endpointType,
                });
              }
              listed = true;
              break outer;
            } catch {
              continue;
            }
          }
        }

        if (!listed) {
          // Soft-retain only for transient list failures when keys exist.
          const retained = previousRows.filter((r) => r.provider === prov.name);
          for (const row of retained) {
            allModels.push({
              modelId: row.modelId,
              providerName: prov.name,
              providerId: prov.id,
              baseUrl: prov.endpoint,
              apiKey: probeKeys[0],
              endpointType,
            });
          }
          if (retained.length) {
            console.warn(
              `[monitor-sweep] ${prov.name}: /models list failed, retained ${retained.length} previous models for re-probe`,
            );
          } else {
            console.warn(
              `[monitor-sweep] ${prov.name}: /models list failed and no previous models to retain (check API keys)`,
            );
          }
        }

        // Also include custom models for this provider
        const customModelsList = await db.select().from(customModels).where(sql`${customModels.providerId} = ${prov.id} AND ${customModels.isActive} = true`);
        for (const cm of customModelsList) {
          const alreadyHas = allModels.some(m => m.modelId === cm.modelId && m.providerId === prov.id);
          if (!alreadyHas) {
            allModels.push({
              modelId: cm.modelId,
              providerName: prov.name,
              providerId: prov.id,
              baseUrl: prov.endpoint,
              apiKey: probeKeys[0],
              endpointType,
            });
          }
        }
      }

      sweepProgress.total = allModels.length;

      // Concurrent all-in-one probe (3 attempts × 180s timeout per model)
      await Promise.allSettled(
        allModels.map(async (m) => {
          const keys = await getProviderProbeKeys(m.providerId, m.apiKey);
          if (keys.length === 0) {
            await upsertModelStatus({
              modelId: m.modelId,
              provider: m.providerName,
              isOnline: false,
              latencyMs: 0,
              httpStatus: 0,
              errorMessage: "No API key",
              baseUrl: m.baseUrl,
            }, { source: "sweep" });
            sweepProgress.tested++;
            sweepProgress.offline++;
            return;
          }

          const start = Date.now();
          let lastStatus = 0;
          let lastError = "Failed";
          let ok = false;

          for (let attempt = 1; attempt <= SWEEP_PROBE_ATTEMPTS && !ok; attempt++) {
            for (const key of keys) {
              try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), SWEEP_PROBE_TIMEOUT_MS);
                const probe = buildProbeRequest(m.baseUrl, m.endpointType, m.modelId, key);
                const res = await fetch(probe.url, { ...probe.init, signal: controller.signal });
                clearTimeout(timeout);
                lastStatus = res.status;
                const text = await res.text();
                const ct = res.headers.get("content-type") || "";
                if (res.ok && isValidProbeBody(res.status, ct, text)) {
                  ok = true;
                  break;
                }
                lastError = res.ok ? "Empty/invalid probe body" : `HTTP ${res.status}`;
              } catch (err: any) {
                lastStatus = 0;
                lastError = err?.name === "AbortError" ? "Timeout" : (err?.message || "Network error");
              }
            }
            if (!ok && attempt < SWEEP_PROBE_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }

          const ms = Date.now() - start;
          await upsertModelStatus({
            modelId: m.modelId,
            provider: m.providerName,
            isOnline: ok,
            latencyMs: ms,
            httpStatus: lastStatus,
            errorMessage: ok ? null : lastError,
            baseUrl: m.baseUrl,
          }, { source: "sweep" });
          sweepProgress.tested++;
          if (ok) sweepProgress.online++;
          else if (lastStatus === 429) sweepProgress.rateLimited++;
          else sweepProgress.offline++;
        }),
      );

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