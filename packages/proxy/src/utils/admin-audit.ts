import { desc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db, pool } from "../db/index.js";
import { adminAuditLogs } from "../db/schema.js";
import { parseSessionClientMeta, requestClientIp } from "./session-client-meta.js";

const SENSITIVE_KEY =
  /^(password|currentpassword|newpassword|confirmpassword|apikey|api_key|token|secret|authorization|key)$/i;

/** Strip secrets from audit detail payloads. */
export function sanitizeAuditDetails(input: unknown, depth = 0): unknown {
  if (depth > 4 || input == null) return input ?? null;
  if (Array.isArray(input)) {
    return input.slice(0, 30).map((v) => sanitizeAuditDetails(v, depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      if (typeof v === "string" && /^(sk-|sk-proxy-|Bearer\s)/i.test(v)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeAuditDetails(v, depth + 1);
    }
    return out;
  }
  if (typeof input === "string" && input.length > 500) {
    return `${input.slice(0, 500)}…`;
  }
  return input;
}

export function deriveAdminAction(method: string, path: string): string {
  const p = path.replace(/^\/admin/, "") || "/";
  const m = method.toUpperCase();
  if (p === "/login" && m === "POST") return "auth.login";
  if (p === "/logout" && m === "POST") return "auth.logout";
  if (/^\/providers\/?\d*$/.test(p) && m === "POST") return "provider.create";
  if (/^\/providers\/\d+$/.test(p) && m === "PUT") return "provider.update";
  if (/^\/providers\/\d+$/.test(p) && m === "DELETE") return "provider.delete";
  if (/\/keys(\/|$)/.test(p) && /providers/.test(p)) {
    if (m === "POST" && /check-all/.test(p)) return "provider.key.check_all";
    if (m === "POST" && /\/check$/.test(p)) return "provider.key.check";
    if (m === "POST" && /reset-limited/.test(p)) return "provider.key.reset_limited";
    if (m === "PATCH" && /toggle/.test(p)) return "provider.key.toggle";
    if (m === "PATCH" && /reset/.test(p)) return "provider.key.reset";
    if (m === "POST") return "provider.key.create";
    if (m === "PUT") return "provider.key.update";
    if (m === "DELETE") return "provider.key.delete";
  }
  if (/custom-models/.test(p)) {
    if (m === "POST") return "provider.custom_model.create";
    if (m === "PUT") return "provider.custom_model.update";
    if (m === "DELETE") return "provider.custom_model.delete";
  }
  if (p === "/keys" && m === "POST") return "key.create";
  if (p === "/keys/override-discord" && m === "POST") return "key.override";
  if (/^\/keys\/\d+$/.test(p) && m === "PUT") return "key.update";
  if (/^\/keys\/\d+$/.test(p) && m === "DELETE") return "key.delete";
  if (/\/rotate$/.test(p) && m === "POST") return "key.rotate";
  if (/\/reveal$/.test(p) && m === "POST") return "key.reveal";
  if (/model-limits/.test(p) && /\/keys\//.test(p)) {
    return m === "DELETE" ? "key.model_limit.delete" : "key.model_limit.upsert";
  }
  if (/day-override/.test(p)) {
    return m === "DELETE" ? "key.day_override.delete" : "key.day_override.upsert";
  }
  if (/reset-today-usage/.test(p)) return "key.usage.reset_today";
  if (p === "/monitor/models/activate") return "model.activate";
  if (p === "/monitor/models/deactivate") return "model.deactivate";
  if (p === "/monitor/models/bulk-override") return "model.bulk_override";
  if (p === "/monitor/sync-catalog") return "model.sync_catalog";
  if (p === "/monitor/sweep") return "model.sweep";
  if (p === "/password") return "settings.password.change";
  if (p === "/settings/global") return "settings.global.update";
  if (p === "/settings" && m === "PUT") return "settings.upstream.update";
  if (p === "/settings/factory-reset") return "settings.factory_reset";
  if (/^\/settings\/model-limits/.test(p)) {
    return m === "DELETE" ? "settings.model_limit.delete" : "settings.model_limit.upsert";
  }
  if (p === "/settings/trial") return "trial.settings.update";
  if (p === "/trial/users/action") return "trial.user.action";
  if (p === "/addons" && m === "POST") return "addon.create";
  if (/^\/addons\/\d+$/.test(p) && m === "PUT") return "addon.update";
  if (/^\/addons\/\d+$/.test(p) && m === "DELETE") return "addon.delete";
  if (p === "/addon-assignments" && m === "POST") return "addon.assignment.create";
  if (/^\/addon-assignments\/\d+$/.test(p) && m === "PATCH") return "addon.assignment.update";
  if (/^\/addon-assignments\/\d+$/.test(p) && m === "DELETE") return "addon.assignment.delete";
  if (/^\/sessions/.test(p)) {
    if (m === "DELETE") return "session.revoke";
    if (/revoke-others/.test(p)) return "session.revoke_others";
  }
  return `${m.toLowerCase()}:${p}`;
}

export async function writeAdminAudit(opts: {
  action: string;
  actor?: string;
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  details?: unknown;
}): Promise<void> {
  try {
    await db.insert(adminAuditLogs).values({
      action: opts.action.slice(0, 120),
      actor: (opts.actor || "admin").slice(0, 80),
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ? opts.userAgent.slice(0, 512) : null,
      country: opts.country ?? null,
      method: opts.method ?? null,
      path: opts.path ? opts.path.slice(0, 300) : null,
      statusCode: opts.statusCode ?? null,
      details: JSON.stringify(sanitizeAuditDetails(opts.details ?? null)),
    });
  } catch (err) {
    console.warn("[admin-audit] write failed:", (err as Error)?.message || err);
  }
}

export async function writeAdminAuditFromContext(
  c: Context,
  action: string,
  details?: unknown,
  statusCode?: number,
): Promise<void> {
  const meta = parseSessionClientMeta(c);
  await writeAdminAudit({
    action,
    actor: (c as any).get("auditActor") || (c.req.header("x-internal-secret") ? "internal" : "admin"),
    ip: meta.ip,
    userAgent: meta.userAgent,
    country: meta.country,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    statusCode: statusCode ?? c.res.status,
    details,
  });
}

const SKIP_AUDIT_PATH =
  /^\/admin\/(health|audit-logs|logs\/stream|me)(\/|$)/i;

export function shouldSkipAdminAudit(path: string, method: string): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return true;
  if (SKIP_AUDIT_PATH.test(path)) return true;
  if (/^\/admin\/(stats|logs)(\/|$)/i.test(path) && method === "GET") return true;
  return false;
}

/** Hono middleware: append-only audit for successful admin mutations. */
export async function adminAuditMiddleware(c: Context, next: () => Promise<void>) {
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  let bodyPreview: unknown = null;
  if (mutating && !shouldSkipAdminAudit(path, method)) {
    try {
      const ct = c.req.header("content-type") || "";
      if (ct.includes("application/json")) {
        bodyPreview = await c.req.raw.clone().json().catch(() => null);
      }
    } catch {
      bodyPreview = null;
    }
  }

  await next();

  if (shouldSkipAdminAudit(path, method)) return;
  const status = c.res.status;
  // Log successes and auth failures on login; skip other 4xx noise from probes
  if (status >= 500) return;
  if (status >= 400 && path !== "/admin/login") return;

  const extra = (c as any).get("auditDetails");
  const action =
    ((c as any).get("auditAction") as string) ||
    deriveAdminAction(method, path);

  void writeAdminAuditFromContext(
    c,
    action,
    {
      ...(extra && typeof extra === "object" ? extra : {}),
      ...(bodyPreview && typeof bodyPreview === "object"
        ? { body: sanitizeAuditDetails(bodyPreview) }
        : {}),
    },
    status,
  );
}

export async function listAdminAuditLogs(opts: {
  limit?: number;
  offset?: number;
  action?: string | null;
}): Promise<{ rows: (typeof adminAuditLogs.$inferSelect)[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
  const offset = Math.max(opts.offset || 0, 0);
  const where = opts.action
    ? eq(adminAuditLogs.action, opts.action)
    : undefined;
  const rows = await db
    .select()
    .from(adminAuditLogs)
    .where(where)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminAuditLogs)
    .where(where);
  return { rows, total: Number(totalRow[0]?.n) || 0 };
}

export async function ensureAdminAuditLogsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      actor TEXT NOT NULL DEFAULT 'admin',
      action TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      country TEXT,
      method TEXT,
      path TEXT,
      status_code INTEGER,
      details TEXT NOT NULL DEFAULT 'null'
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs (action);
  `);
  // Harden: revoke DELETE/TRUNCATE from app role if possible (best-effort)
  try {
    await pool.query(`
      REVOKE DELETE, TRUNCATE ON admin_audit_logs FROM PUBLIC;
    `);
  } catch {
    // ignore — may not have privilege
  }
}

export { requestClientIp };
