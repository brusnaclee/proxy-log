import { Hono } from "hono";
import { db } from "../../db/index.js";
import { providers } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { refreshModelCatalog, getProviderApiKeys, addProviderApiKey, resetKeyLimited, deleteApiKey, toggleKeyActive, updateApiKey } from "../../utils/model-catalog.js";
import { sanitizeProviderApiKey } from "../../utils/crypto.js";
import { purgeMonitorForProvider } from "../../utils/model-monitor-store.js";

const providersApi = new Hono();

providersApi.get("/providers", async (c) => {
  const list = await db.select().from(providers).orderBy(desc(providers.priority));
  return c.json(list);
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

export default providersApi;
