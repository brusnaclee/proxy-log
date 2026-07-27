import { Context } from "hono";
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
import { parseSessionClientMeta } from "../utils/session-client-meta.js";
import { shouldUseSecureCookies } from "../utils/cookie-secure.js";

const COOKIE_NAME = "session";

startAuthSessionPurgeJob();

function setSessionCookie(c: Context, sessionId: string, maxAgeSec: number): void {
  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: shouldUseSecureCookies(c),
    sameSite: "Lax",
    maxAge: maxAgeSec,
    path: "/",
  });
}

export function getAdminSessionRawId(c: Context): string | undefined {
  return getCookie(c, COOKIE_NAME);
}

/**
 * Create a new admin session and set the cookie.
 */
export async function createSession(
  c: Context,
  clientHint?: { platform?: string; mobile?: boolean; label?: string } | null,
): Promise<string> {
  const meta = parseSessionClientMeta(c, clientHint);
  const sessionId = await createAuthSession({
    kind: "admin",
    meta,
  });
  setSessionCookie(c, sessionId, Math.floor(AUTH_SESSION_TTL_MS / 1000));
  return sessionId;
}

export async function destroySession(c: Context): Promise<void> {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId) {
    try {
      await destroyAuthSession(sessionId, "admin");
    } catch {
      // still clear cookie
    }
  }
  deleteCookie(c, COOKIE_NAME, {
    path: "/",
    secure: shouldUseSecureCookies(c),
    sameSite: "Lax",
  });
}

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
    void touchAuthSession(session.id, session.lastSeenAt, {
      ip: parseSessionClientMeta(c).ip,
    });
    return true;
  } catch {
    return false;
  }
}

export function isInternalRequest(c: Context): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const provided = c.req.header("x-internal-secret");
  return provided === expected;
}

export async function authMiddleware(c: Context, next: () => Promise<void>) {
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
    (c as any).set("auditActor", "internal");
    return next();
  }

  if (!(await isAuthenticated(c))) {
    return c.json({ error: "Unauthorized. Please login first." }, 401);
  }

  return next();
}
