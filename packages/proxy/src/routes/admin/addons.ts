import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { addonAssignments, addons, apiKeys } from "../../db/schema.js";
import { parseAllowlist } from "../../utils/addons.js";

const addonsApi = new Hono();

function normalizeAllowlistInput(raw: unknown): string {
  if (Array.isArray(raw)) {
    return JSON.stringify(raw.map((x) => String(x || "").trim()).filter(Boolean));
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "[]";
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed.map((x) => String(x || "").trim()).filter(Boolean));
      }
    } catch {
      /* treat as comma-separated */
    }
    return JSON.stringify(
      trimmed
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return "[]";
}

addonsApi.get("/addons", async (c) => {
  const rows = await db.select().from(addons).orderBy(desc(addons.id));
  return c.json({
    data: rows.map((r) => ({
      ...r,
      modelAllowlistParsed: parseAllowlist(r.modelAllowlist),
    })),
  });
});

addonsApi.post("/addons", async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    modelAllowlist?: string | string[];
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
    dailyInputTokenLimit?: number;
    dailyOutputTokenLimit?: number;
    promptLimit?: number;
    promptLimitWindow?: string;
    discordRoleId?: string | null;
    isActive?: boolean;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const [row] = await db
    .insert(addons)
    .values({
      name: body.name.trim(),
      description: body.description?.trim() || "",
      modelAllowlist: normalizeAllowlistInput(body.modelAllowlist),
      dailyTokenLimit: Math.max(0, body.dailyTokenLimit || 0),
      monthlyTokenLimit: Math.max(0, body.monthlyTokenLimit || 0),
      dailyInputTokenLimit: Math.max(0, body.dailyInputTokenLimit || 0),
      dailyOutputTokenLimit: Math.max(0, body.dailyOutputTokenLimit || 0),
      promptLimit: Math.max(0, body.promptLimit || 0),
      promptLimitWindow: body.promptLimitWindow || "1d",
      discordRoleId: body.discordRoleId || null,
      isActive: body.isActive ?? true,
    })
    .returning();

  return c.json({ success: true, addon: row });
});

addonsApi.put("/addons/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const [existing] = await db.select().from(addons).where(eq(addons.id, id));
  if (!existing) return c.json({ error: "Addon not found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.description === "string") updates.description = body.description.trim();
  if (body.modelAllowlist !== undefined) updates.modelAllowlist = normalizeAllowlistInput(body.modelAllowlist);
  if (body.dailyTokenLimit !== undefined) updates.dailyTokenLimit = Math.max(0, Number(body.dailyTokenLimit) || 0);
  if (body.monthlyTokenLimit !== undefined) updates.monthlyTokenLimit = Math.max(0, Number(body.monthlyTokenLimit) || 0);
  if (body.dailyInputTokenLimit !== undefined) updates.dailyInputTokenLimit = Math.max(0, Number(body.dailyInputTokenLimit) || 0);
  if (body.dailyOutputTokenLimit !== undefined) updates.dailyOutputTokenLimit = Math.max(0, Number(body.dailyOutputTokenLimit) || 0);
  if (body.promptLimit !== undefined) updates.promptLimit = Math.max(0, Number(body.promptLimit) || 0);
  if (typeof body.promptLimitWindow === "string") updates.promptLimitWindow = body.promptLimitWindow;
  if (body.discordRoleId !== undefined) updates.discordRoleId = body.discordRoleId || null;
  if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);

  const [row] = await db.update(addons).set(updates as any).where(eq(addons.id, id)).returning();
  return c.json({ success: true, addon: row });
});

addonsApi.delete("/addons/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  await db.delete(addons).where(eq(addons.id, id));
  return c.json({ success: true });
});

addonsApi.get("/addons/:id/assignments", async (c) => {
  const id = parseInt(c.req.param("id"));
  const rows = await db
    .select()
    .from(addonAssignments)
    .where(eq(addonAssignments.addonId, id))
    .orderBy(desc(addonAssignments.id));
  return c.json({ data: rows });
});

addonsApi.get("/addon-assignments", async (c) => {
  const discordUserId = c.req.query("discordUserId");
  const conditions = discordUserId
    ? and(eq(addonAssignments.discordUserId, discordUserId))
    : undefined;
  const rows = await db
    .select({
      assignment: addonAssignments,
      addonName: addons.name,
      addonAllowlist: addons.modelAllowlist,
    })
    .from(addonAssignments)
    .innerJoin(addons, eq(addonAssignments.addonId, addons.id))
    .where(conditions)
    .orderBy(desc(addonAssignments.id));
  return c.json({
    data: rows.map((r) => ({
      ...r.assignment,
      addonName: r.addonName,
      modelAllowlistParsed: parseAllowlist(r.addonAllowlist),
    })),
  });
});

addonsApi.post("/addon-assignments", async (c) => {
  const body = await c.req.json<{
    addonId: number;
    discordUserId?: string;
    apiKeyId?: number;
    expiresAt?: string | null;
    assignedBy?: string;
  }>();
  if (!body.addonId) return c.json({ error: "addonId is required" }, 400);
  if (!body.discordUserId && !body.apiKeyId) {
    return c.json({ error: "discordUserId or apiKeyId is required" }, 400);
  }

  const [addon] = await db.select().from(addons).where(eq(addons.id, body.addonId));
  if (!addon) return c.json({ error: "Addon not found" }, 404);

  if (body.apiKeyId) {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, body.apiKeyId));
    if (!key) return c.json({ error: "API key not found" }, 404);
  }

  const [row] = await db
    .insert(addonAssignments)
    .values({
      addonId: body.addonId,
      discordUserId: body.discordUserId || null,
      apiKeyId: body.apiKeyId || null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      assignedBy: body.assignedBy || "dashboard",
      isActive: true,
    })
    .returning();

  return c.json({ success: true, assignment: row });
});

addonsApi.patch("/addon-assignments/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json<{ isActive?: boolean; expiresAt?: string | null }>();
  const updates: Record<string, unknown> = {};
  if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
  if (body.expiresAt !== undefined) {
    updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }
  const [row] = await db
    .update(addonAssignments)
    .set(updates as any)
    .where(eq(addonAssignments.id, id))
    .returning();
  if (!row) return c.json({ error: "Assignment not found" }, 404);
  return c.json({ success: true, assignment: row });
});

addonsApi.delete("/addon-assignments/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  await db.delete(addonAssignments).where(eq(addonAssignments.id, id));
  return c.json({ success: true });
});

export default addonsApi;
