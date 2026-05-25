import { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { generateSessionId } from "../utils/crypto.js";

// In-memory session store (suitable for single-instance SQLite setup)
const sessions = new Map<string, { createdAt: number }>();

// Session expiry: 24 hours
const SESSION_TTL = 24 * 60 * 60 * 1000;

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 60 * 1000); // every minute

/**
 * Create a new session and set the cookie
 */
export function createSession(c: Context): string {
  const sessionId = generateSessionId();
  sessions.set(sessionId, { createdAt: Date.now() });

  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: false, // set to true in production with HTTPS
    sameSite: "Lax",
    maxAge: SESSION_TTL / 1000,
    path: "/",
  });

  return sessionId;
}

/**
 * Destroy the current session
 */
export function destroySession(c: Context): void {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    sessions.delete(sessionId);
  }
  deleteCookie(c, "session", { path: "/" });
}

/**
 * Check if the current request has a valid session
 */
export function isAuthenticated(c: Context): boolean {
  const sessionId = getCookie(c, "session");
  if (!sessionId) return false;

  const session = sessions.get(sessionId);
  if (!session) return false;

  // Check expiry
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(sessionId);
    return false;
  }

  return true;
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
  // Allow login, OPTIONS, and health check without auth
  const path = c.req.path;
  if (
    path === "/admin/login" ||
    path === "/admin/health" ||
    c.req.method === "OPTIONS"
  ) {
    return next();
  }

  // Allow trusted internal calls (Discord bot integration)
  if (isInternalRequest(c)) {
    return next();
  }

  if (!isAuthenticated(c)) {
    return c.json({ error: "Unauthorized. Please login first." }, 401);
  }

  return next();
}
