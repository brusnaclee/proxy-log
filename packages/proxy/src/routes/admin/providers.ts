import { Hono } from "hono";
import { db } from "../../db/index.js";
import { providers, customModels, modelMonitor } from "../../db/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";
import { refreshModelCatalog, getProviderApiKeys, addProviderApiKey, resetKeyLimited, resetAllLimitedKeys, deleteApiKey, toggleKeyActive, updateApiKey, checkProviderApiKeyHealth, syncProviderToMonitor } from "../../utils/model-catalog.js";
import { sanitizeProviderApiKey } from "../../utils/crypto.js";
import { purgeMonitorForProvider, renameProviderInMonitor } from "../../utils/model-monitor-store.js";
import {
  invalidateVendorAliasCache,
  normalizeVendorAliases,
  parseVendorAliases,
  stringifyVendorAliases,
  vendorOf,
} from "../../utils/vendor-aliases.js";

const providersApi = new Hono();

async function discoverVendorsForProvider(providerName: string): Promise<string[]> {
  const rows = await db
    .select({ modelId: modelMonitor.modelId })
    .from(modelMonitor)
    .where(eq(modelMonitor.provider, providerName));
  const set = new Set<string>();
  for (const r of rows) {
    const v = vendorOf(String(r.modelId || ""));
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function enrichProvider(p: typeof providers.$inferSelect, catalogModelCount: number, vendors: string[]) {
  const vendorAliases = parseVendorAliases((p as any).vendorAliases);
  // Include alias keys even if no longer in monitor
  for (const k of Object.keys(vendorAliases)) {
    if (!vendors.includes(k)) vendors.push(k);
  }
  vendors.sort((a, b) => a.localeCompare(b));
  return {
    ...p,
    vendorAliases,
    vendors,
    catalogModelCount,
  };
}

providersApi.get("/providers", async (c) => {
  const list = await db.select().from(providers).orderBy(desc(providers.priority));
  // Enrich with catalog model counts so dashboard can show "ready to configure"
  const counts = (await db.execute(sql`
    SELECT provider, COUNT(*)::int AS cnt
    FROM model_monitor
    WHERE provider IS NOT NULL
    GROUP BY provider
  `)).rows as Array<{ provider: string; cnt: number }>;
  const countMap = new Map(counts.map((r) => [r.provider, Number(r.cnt) || 0]));

  const vendorRows = (await db.execute(sql`
    SELECT provider, model_id AS "modelId"
    FROM model_monitor
    WHERE provider IS NOT NULL AND model_id LIKE '%/%'
  `)).rows as Array<{ provider: string; modelId: string }>;
  const vendorsByProvider = new Map<string, Set<string>>();
  for (const r of vendorRows) {
    const v = vendorOf(r.modelId);
    if (!v) continue;
    if (!vendorsByProvider.has(r.provider)) vendorsByProvider.set(r.provider, new Set());
    vendorsByProvider.get(r.provider)!.add(v);
  }

  return c.json(list.map((p) => enrichProvider(
    p,
    countMap.get(p.name) || 0,
    [...(vendorsByProvider.get(p.name) || new Set())],
  )));
});

// Get a single provider by ID
providersApi.get("/providers/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [provider] = await db.select().from(providers).where(eq(providers.id, id));
  if (!provider) return c.json({ error: "Provider not found" }, 404);
  const vendors = await discoverVendorsForProvider(provider.name);
  return c.json(enrichProvider(provider, 0, vendors));
});

providersApi.post("/providers", async (c) => {
  const body = await c.req.json<{
    name: string;
    endpoint: string;
    apiKey: string;
    isActive?: boolean;
    priority?: number;
    endpointType?: string;
    compatProfile?: string;
  }>();
  if (!body.name || !body.endpoint || !body.apiKey) {
    return c.json({ error: "Missing required fields" }, 400);
  }
  const { inferCompatProfile } = await import("../../utils/amanai-compat.js");
  const compatProfile = inferCompatProfile({
    name: body.name,
    endpoint: body.endpoint,
    compatProfile: body.compatProfile,
  });
  const [result] = await db.insert(providers).values({
    name: body.name,
    endpoint: body.endpoint,
    apiKey: sanitizeProviderApiKey(body.apiKey),
    endpointType: body.endpointType || "openai",
    compatProfile,
    isActive: body.isActive ?? true,
    priority: body.priority || 0,
  }).returning();

  // Also add the key to the providerApiKeys table for rotation
  const keyId = await addProviderApiKey(result.id, body.apiKey);
  const health = await checkProviderApiKeyHealth(result.id, keyId);

  await refreshModelCatalog();
  let catalog = { provider: result.name, seeded: 0, listed: 0 };
  // Always try /models → Model Monitor (even if key probe reported limited/invalid).
  if (result.isActive) {
    catalog = await syncProviderToMonitor(result.id);
  }

  return c.json({
    success: true,
    provider: result,
    health: {
      ok: health.ok,
      status: health.status,
      error: health.error,
      modelCount: health.modelCount,
    },
    catalog,
  });
});

providersApi.put("/providers/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    endpoint?: string;
    apiKey?: string;
    isActive?: boolean;
    priority?: number;
    endpointType?: string;
    compatProfile?: string;
    vendorAliases?: Record<string, string> | string | null;
  }>();
  const updates: any = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.endpoint !== undefined) updates.endpoint = body.endpoint;
  if (body.apiKey !== undefined) updates.apiKey = sanitizeProviderApiKey(body.apiKey);
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.endpointType !== undefined) updates.endpointType = body.endpointType;
  if (body.compatProfile !== undefined) {
    const { normalizeCompatProfile } = await import("../../utils/amanai-compat.js");
    updates.compatProfile = normalizeCompatProfile(body.compatProfile);
  }
  if (body.vendorAliases !== undefined) {
    try {
      const parsed =
        typeof body.vendorAliases === "string"
          ? parseVendorAliases(body.vendorAliases)
          : normalizeVendorAliases((body.vendorAliases || {}) as Record<string, unknown>);
      updates.vendorAliases = stringifyVendorAliases(parsed);
    } catch (err: any) {
      return c.json({ error: err?.message || "Invalid vendorAliases" }, 400);
    }
  }
  updates.updatedAt = new Date();

  await db.update(providers).set(updates).where(eq(providers.id, id));
  invalidateVendorAliasCache();

  if (body.name && body.name !== existing.name) {
    await renameProviderInMonitor(existing.name, body.name);
  }

  if (body.isActive === false) {
    await purgeMonitorForProvider(body.name || existing.name);
  }

  await refreshModelCatalog();
  const nowActive = body.isActive !== undefined ? body.isActive : existing.isActive;
  if (nowActive) {
    void syncProviderToMonitor(id);
  }

  return c.json({ success: true });
});

providersApi.delete("/providers/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (existing) {
    await purgeMonitorForProvider(existing.name);
  }
  await db.delete(providers).where(eq(providers.id, id));

  void refreshModelCatalog();

  return c.json({ success: true });
});

// ─── Provider API Key Management ──────────────────────────────────────────────

// Get all keys for a provider
providersApi.get("/providers/:id/keys", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);

  const keys = await getProviderApiKeys(id);
  return c.json(keys);
});

// Add a new key to a provider
providersApi.post("/providers/:id/keys", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);

  const body = await c.req.json<{ apiKey: string }>();
  if (!body.apiKey) return c.json({ error: "apiKey is required" }, 400);

  const keyId = await addProviderApiKey(id, body.apiKey);
  const health = await checkProviderApiKeyHealth(id, keyId);
  await refreshModelCatalog();
  let catalog = { provider: existing.name, seeded: 0, listed: 0 };
  if (existing.isActive) {
    catalog = await syncProviderToMonitor(id);
  }
  return c.json({
    success: true,
    keyId,
    health: {
      ok: health.ok,
      status: health.status,
      error: health.error,
      modelCount: health.modelCount,
    },
    catalog,
  });
});

// Probe a key against upstream /models and update health badge.
// On success, auto-ingest /models into Model Monitor catalog.
providersApi.post("/providers/:id/keys/:keyId/check", async (c) => {
  const id = parseInt(c.req.param("id"));
  const keyId = parseInt(c.req.param("keyId"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);
  const health = await checkProviderApiKeyHealth(id, keyId);
  let catalog = null as null | { provider: string; seeded: number; listed: number };
  if (existing.isActive) {
    await refreshModelCatalog();
    catalog = await syncProviderToMonitor(id);
  }
  return c.json({ success: true, ...health, catalog });
});

// Check all keys for a provider
providersApi.post("/providers/:id/keys/check-all", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);
  const keys = await getProviderApiKeys(id);
  const results = [];
  for (const k of keys) {
    const h = await checkProviderApiKeyHealth(id, k.id);
    results.push({ keyId: k.id, ...h });
  }
  let catalog = null as null | { provider: string; seeded: number; listed: number };
  if (existing.isActive) {
    await refreshModelCatalog();
    catalog = await syncProviderToMonitor(id);
  }
  return c.json({ success: true, results, catalog });
});

// Reset a key's limited status (Retry button)
providersApi.patch("/providers/:id/keys/:keyId/reset", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  await resetKeyLimited(keyId);
  return c.json({ success: true });
});

// Reset ALL limited keys for a provider
providersApi.post("/providers/:id/keys/reset-limited", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);
  const reset = await resetAllLimitedKeys(id);
  return c.json({ success: true, reset });
});

// Toggle a key's active status (Enable/Disable button)
providersApi.patch("/providers/:id/keys/:keyId/toggle", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  const newActive = await toggleKeyActive(keyId);
  return c.json({ success: true, isActive: newActive });
});

// Update a key's value (Edit key) — re-probe and sync catalog if valid
providersApi.put("/providers/:id/keys/:keyId", async (c) => {
  const id = parseInt(c.req.param("id"));
  const keyId = parseInt(c.req.param("keyId"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);
  const body = await c.req.json<{ apiKey: string }>();
  if (!body.apiKey) return c.json({ error: "apiKey is required" }, 400);
  await updateApiKey(keyId, body.apiKey);
  const health = await checkProviderApiKeyHealth(id, keyId);
  let catalog = null as null | { provider: string; seeded: number; listed: number };
  if (existing.isActive) {
    await refreshModelCatalog();
    catalog = await syncProviderToMonitor(id);
  }
  return c.json({
    success: true,
    health: {
      ok: health.ok,
      status: health.status,
      error: health.error,
      modelCount: health.modelCount,
    },
    catalog,
  });
});

// Delete a key (Delete button)
providersApi.delete("/providers/:id/keys/:keyId", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  await deleteApiKey(keyId);
  return c.json({ success: true });
});

// ─── Custom Models Management ──────────────────────────────────────────────────

// List custom models for a provider
providersApi.get("/providers/:id/custom-models", async (c) => {
  const providerId = parseInt(c.req.param("id"));
  const models = await db.select().from(customModels)
    .where(eq(customModels.providerId, providerId))
    .orderBy(customModels.createdAt);
  return c.json(models);
});

// Add a custom model to a provider
providersApi.post("/providers/:id/custom-models", async (c) => {
  const providerId = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, providerId));
  if (!existing) return c.json({ error: "Provider not found" }, 404);

  const body = await c.req.json<{
    modelId: string;
    displayName?: string;
    description?: string;
    contextLength?: number;
    maxOutputTokens?: number;
    inputPricePerMtok?: number;
    outputPricePerMtok?: number;
    inputModalities?: string[];
    outputModalities?: string[];
    supportedFeatures?: string[];
  }>();

  if (!body.modelId) return c.json({ error: "modelId is required" }, 400);

  // Check for duplicate model in this provider
  const [duplicate] = await db.select().from(customModels)
    .where(eq(customModels.providerId, providerId))
    .where(eq(customModels.modelId, body.modelId));
  if (duplicate) return c.json({ error: "Model already exists for this provider" }, 409);

  const [result] = await db.insert(customModels).values({
    providerId,
    modelId: body.modelId,
    displayName: body.displayName || body.modelId,
    description: body.description || null,
    contextLength: body.contextLength || null,
    maxOutputTokens: body.maxOutputTokens || null,
    inputPricePerMtok: body.inputPricePerMtok || 0,
    outputPricePerMtok: body.outputPricePerMtok || 0,
    inputModalities: body.inputModalities ? JSON.stringify(body.inputModalities) : null,
    outputModalities: body.outputModalities ? JSON.stringify(body.outputModalities) : null,
    supportedFeatures: body.supportedFeatures ? JSON.stringify(body.supportedFeatures) : null,
  }).returning();

  void refreshModelCatalog();
  return c.json({ success: true, model: result });
});

// Update a custom model
providersApi.put("/providers/:id/custom-models/:modelId", async (c) => {
  const providerId = parseInt(c.req.param("id"));
  const modelId = c.req.param("modelId");

  const [existing] = await db.select().from(customModels)
    .where(eq(customModels.providerId, providerId))
    .where(eq(customModels.modelId, modelId));
  if (!existing) return c.json({ error: "Custom model not found" }, 404);

  const body = await c.req.json<{
    displayName?: string;
    description?: string;
    contextLength?: number;
    maxOutputTokens?: number;
    inputPricePerMtok?: number;
    outputPricePerMtok?: number;
    inputModalities?: string[];
    outputModalities?: string[];
    supportedFeatures?: string[];
    isActive?: boolean;
  }>();

  const updates: any = { updatedAt: new Date() };
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.description !== undefined) updates.description = body.description;
  if (body.contextLength !== undefined) updates.contextLength = body.contextLength;
  if (body.maxOutputTokens !== undefined) updates.maxOutputTokens = body.maxOutputTokens;
  if (body.inputPricePerMtok !== undefined) updates.inputPricePerMtok = body.inputPricePerMtok;
  if (body.outputPricePerMtok !== undefined) updates.outputPricePerMtok = body.outputPricePerMtok;
  if (body.inputModalities !== undefined) updates.inputModalities = JSON.stringify(body.inputModalities);
  if (body.outputModalities !== undefined) updates.outputModalities = JSON.stringify(body.outputModalities);
  if (body.supportedFeatures !== undefined) updates.supportedFeatures = JSON.stringify(body.supportedFeatures);
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(customModels).set(updates)
    .where(eq(customModels.providerId, providerId))
    .where(eq(customModels.modelId, modelId));

  void refreshModelCatalog();
  return c.json({ success: true });
});

// Delete a custom model
providersApi.delete("/providers/:id/custom-models/:modelId", async (c) => {
  const providerId = parseInt(c.req.param("id"));
  const modelId = c.req.param("modelId");

  const [existing] = await db.select().from(customModels)
    .where(eq(customModels.providerId, providerId))
    .where(eq(customModels.modelId, modelId));
  if (!existing) return c.json({ error: "Custom model not found" }, 404);

  await db.delete(customModels)
    .where(eq(customModels.providerId, providerId))
    .where(eq(customModels.modelId, modelId));

  void refreshModelCatalog();
  return c.json({ success: true });
});

export default providersApi;
