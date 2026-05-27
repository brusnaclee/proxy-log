import { Hono } from "hono";
import { db } from "../../db/index.js";
import { providers } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";

const providersApi = new Hono();

providersApi.get("/providers", async (c) => {
  const list = await db.select().from(providers).orderBy(desc(providers.priority)).all();
  return c.json(list);
});

providersApi.post("/providers", async (c) => {
  const body = await c.req.json<{ name: string; endpoint: string; apiKey: string; isActive?: boolean; priority?: number }>();
  if (!body.name || !body.endpoint || !body.apiKey) {
    return c.json({ error: "Missing required fields" }, 400);
  }
  const result = await db.insert(providers).values({
    name: body.name,
    endpoint: body.endpoint,
    apiKey: body.apiKey,
    isActive: body.isActive ?? true,
    priority: body.priority || 0,
  }).returning().get();
  return c.json({ success: true, provider: result });
});

providersApi.put("/providers/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json<{ name?: string; endpoint?: string; apiKey?: string; isActive?: boolean; priority?: number }>();
  const updates: any = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.endpoint !== undefined) updates.endpoint = body.endpoint;
  if (body.apiKey !== undefined) updates.apiKey = body.apiKey;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.priority !== undefined) updates.priority = body.priority;
  updates.updatedAt = new Date().toISOString().replace("T", " ").substring(0, 19);
  
  await db.update(providers).set(updates).where(eq(providers.id, id)).run();
  return c.json({ success: true });
});

providersApi.delete("/providers/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  await db.delete(providers).where(eq(providers.id, id)).run();
  return c.json({ success: true });
});

export default providersApi;