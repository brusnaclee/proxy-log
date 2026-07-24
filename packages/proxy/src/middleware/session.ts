import { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  AUTH_SESSION_TTL_MS,
  createAuthSession,
  destroyAuthSession,
  getAuthSession,
  remainingTtlSeconds,
  startAuthSessionPurgeJob,
  touchAuthSession,
} from "../utils/auth-sessions.js";

const COOKIE_NAME = "session";

startAuthSessionPurgeJob();

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1";
}

function clientMeta(c: Context): { ip: string; userAgent: string } {
  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const userAgent = c.req.header("user-agent") || "";
  return { ip, userAgent };
}

function setSessionCookie(c: Context, sessionId: string, maxAgeSec: number): void {
  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "Lax",
    maxAge: maxAgeSec,
    path: "/",
  });
}

/**
 * Create a new admin session and set the cookie.
 */
export async function createSession(c: Context): Promise<string> {
  const { ip, userAgent } = clientMeta(c);
  const sessionId = await createAuthSession({
    kind: "admin",
    ip,
    userAgent,
  });
  setSessionCookie(c, sessionId, Math.floor(AUTH_SESSION_TTL_MS / 1000));
  return sessionId;
}

/**
 * Destroy the current admin session (DB row + cookie).
 * Safe to call when session is missing/expired — still clears cookie.
 */
export async function destroySession(c: Context): Promise<void> {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId) {
    try {
      await destroyAuthSession(sessionId, "admin");
    } catch {
      // still clear cookie
    }
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/**
 * Check if the current request has a valid admin session.
 * On success, refreshes cookie maxAge to remaining TTL and lightly touches last_seen.
 */
export async function isAuthenticated(c: Context): Promise<boolean> {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return false;

  try {
    const session = await getAuthSession(sessionId, "admin");
    if (!session) return false;

    const maxAge = remainingTtlSeconds(session.createdAt);
    if (maxAge <= 0) {
      await destroyAuthSession(sessionId, "admin");
      return false;
    }

    setSessionCookie(c, sessionId, maxAge);
    void touchAuthSession(session.id, session.lastSeenAt);
    return true;
  } catch {
    return false;
  }
}

/**
 * Internal service-to-service auth for bot -> proxy requests.
 */
export function isInternalRequest(c: Context): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const provided = c.req.header("x-internal-secret");
  return provided === expected;
}

/**
 * Auth middleware — blocks unauthenticated requests to admin routes
 */
export async function authMiddleware(c: Context, next: Next) {
  const path = c.req.path;
  if (
    path === "/admin/login" ||
    path === "/admin/logout" ||
    path === "/admin/health" ||
    c.req.method === "OPTIONS"
  ) {
    return next();
  }

  if (isInternalRequest(c)) {
    return next();
  }

  if (!(await isAuthenticated(c))) {
    return c.json({ error: "Unauthorized. Please login first." }, 401);
  }

  return next();
}
