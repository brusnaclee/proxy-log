import { Hono } from "hono";
import { db } from "../../db/index.js";
import { providers, customModels } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { refreshModelCatalog, getProviderApiKeys, addProviderApiKey, resetKeyLimited, deleteApiKey, toggleKeyActive, updateApiKey } from "../../utils/model-catalog.js";
import { sanitizeProviderApiKey } from "../../utils/crypto.js";
import { purgeMonitorForProvider } from "../../utils/model-monitor-store.js";

const providersApi = new Hono();

providersApi.get("/providers", async (c) => {
  const list = await db.select().from(providers).orderBy(desc(providers.priority));
  return c.json(list);
});

// Get a single provider by ID
providersApi.get("/providers/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [provider] = await db.select().from(providers).where(eq(providers.id, id));
  if (!provider) return c.json({ error: "Provider not found" }, 404);
  return c.json(provider);
});

providersApi.post("/providers", async (c) => {
  const body = await c.req.json<{ name: string; endpoint: string; apiKey: string; isActive?: boolean; priority?: number; endpointType?: string }>();
  if (!body.name || !body.endpoint || !body.apiKey) {
    return c.json({ error: "Missing required fields" }, 400);
  }
  const [result] = await db.insert(providers).values({
    name: body.name,
    endpoint: body.endpoint,
    apiKey: sanitizeProviderApiKey(body.apiKey),
    endpointType: body.endpointType || "openai",
    isActive: body.isActive ?? true,
    priority: body.priority || 0,
  }).returning();

  // Also add the key to the providerApiKeys table for rotation
  await addProviderApiKey(result.id, body.apiKey);

  void refreshModelCatalog();

  return c.json({ success: true, provider: result });
});

providersApi.put("/providers/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(providers).where(eq(providers.id, id));
  if (!existing) return c.json({ error: "Provider not found" }, 404);

  const body = await c.req.json<{ name?: string; endpoint?: string; apiKey?: string; isActive?: boolean; priority?: number; endpointType?: string }>();
  const updates: any = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.endpoint !== undefined) updates.endpoint = body.endpoint;
  if (body.apiKey !== undefined) updates.apiKey = sanitizeProviderApiKey(body.apiKey);
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.endpointType !== undefined) updates.endpointType = body.endpointType;
  updates.updatedAt = new Date();

  await db.update(providers).set(updates).where(eq(providers.id, id));

  if (body.isActive === false) {
    await purgeMonitorForProvider(existing.name);
  }

  void refreshModelCatalog();

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
  return c.json({ success: true, keyId });
});

// Reset a key's limited status (Retry button)
providersApi.patch("/providers/:id/keys/:keyId/reset", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  await resetKeyLimited(keyId);
  return c.json({ success: true });
});

// Toggle a key's active status (Enable/Disable button)
providersApi.patch("/providers/:id/keys/:keyId/toggle", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  const newActive = await toggleKeyActive(keyId);
  return c.json({ success: true, isActive: newActive });
});

// Update a key's value (Edit key)
providersApi.put("/providers/:id/keys/:keyId", async (c) => {
  const keyId = parseInt(c.req.param("keyId"));
  const body = await c.req.json<{ apiKey: string }>();
  if (!body.apiKey) return c.json({ error: "apiKey is required" }, 400);
  await updateApiKey(keyId, body.apiKey);
  return c.json({ success: true });
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
