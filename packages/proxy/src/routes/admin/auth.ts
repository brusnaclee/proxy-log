import { Hono } from "hono";
import { db } from "../../db/index.js";
import { adminConfig } from "../../db/schema.js";
import { createSession, destroySession, isAuthenticated } from "../../middleware/session.js";

const auth = new Hono();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || now > row.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (row.count >= LOGIN_MAX) return false;
  row.count += 1;
  return true;
}

auth.post("/login", async (c) => {
  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (!checkLoginRateLimit(ip)) {
    return c.json({ error: "Too many login attempts. Try again later." }, 429);
  }

  const body = await c.req.json<{
    password: string;
    clientHint?: { platform?: string; mobile?: boolean; label?: string };
  }>();
  if (!body.password) return c.json({ error: "Password is required" }, 400);

  const config = (await db.select().from(adminConfig))[0];
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const { verify } = await import("@node-rs/argon2");
  const isValid = await verify(config.passwordHash, body.password);
  if (!isValid) {
    (c as any).set("auditAction", "auth.login");
    (c as any).set("auditDetails", { ok: false });
    return c.json({ error: "Invalid password" }, 401);
  }

  await createSession(c, body.clientHint ?? null);
  (c as any).set("auditAction", "auth.login");
  (c as any).set("auditDetails", { ok: true });
  return c.json({ success: true, message: "Logged in successfully" });
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  (c as any).set("auditAction", "auth.logout");
  return c.json({ success: true, message: "Logged out" });
});

auth.get("/me", async (c) => {
  return c.json({ authenticated: await isAuthenticated(c) });
});

export default auth;
