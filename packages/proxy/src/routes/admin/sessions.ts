import { Hono } from "hono";
import {
  destroyAuthSessionById,
  destroyOtherAuthSessions,
  listAuthSessions,
} from "../../utils/auth-sessions.js";
import {
  getAdminSessionRawId,
  isAuthenticated,
} from "../../middleware/session.js";
import { listAdminAuditLogs } from "../../utils/admin-audit.js";

const sessions = new Hono();

sessions.get("/sessions", async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: "Unauthorized" }, 401);
  const kind = (c.req.query("kind") || "admin") as "admin" | "portal";
  if (kind !== "admin" && kind !== "portal") {
    return c.json({ error: "kind must be admin or portal" }, 400);
  }
  const rawId = getAdminSessionRawId(c);
  const rows = await listAuthSessions({
    kind,
    currentRawId: kind === "admin" ? rawId : null,
    limit: Number(c.req.query("limit") || 100),
  });
  return c.json({ sessions: rows });
});

sessions.delete("/sessions/:id", async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: "Unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const kind = (c.req.query("kind") || "admin") as "admin" | "portal";
  const ok = await destroyAuthSessionById(id, kind);
  if (!ok) return c.json({ error: "Session not found" }, 404);
  (c as any).set("auditAction", "session.revoke");
  (c as any).set("auditDetails", { sessionId: id, kind });
  return c.json({ success: true });
});

sessions.post("/sessions/revoke-others", async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: "Unauthorized" }, 401);
  const rawId = getAdminSessionRawId(c);
  if (!rawId) return c.json({ error: "No current session" }, 400);
  const body = await c.req.json<{ kind?: string }>().catch(() => ({}));
  const kind = (body.kind || "admin") as "admin" | "portal";
  if (kind !== "admin") {
    return c.json({ error: "Admin revoke-others only applies to admin sessions" }, 400);
  }
  const n = await destroyOtherAuthSessions("admin", rawId);
  (c as any).set("auditAction", "session.revoke_others");
  (c as any).set("auditDetails", { revoked: n, kind: "admin" });
  return c.json({ success: true, revoked: n });
});

sessions.get("/audit-logs", async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: "Unauthorized" }, 401);
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  const action = c.req.query("action") || null;
  const { rows, total } = await listAdminAuditLogs({ limit, offset, action });
  return c.json({
    total,
    logs: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.actor,
      action: r.action,
      ip: r.ip,
      userAgent: r.userAgent,
      country: r.country,
      method: r.method,
      path: r.path,
      statusCode: r.statusCode,
      details: (() => {
        try {
          return JSON.parse(r.details || "null");
        } catch {
          return null;
        }
      })(),
    })),
  });
});

export default sessions;
