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

const COOKIE_NAME = "portal_session";

startAuthSessionPurgeJob();

function cookieSecure(): boolean {
  // Only Secure when explicitly enabled. NODE_ENV=production alone is NOT enough —
  // admin (:5173) and portal often run over plain HTTP; Secure cookies are dropped by the browser.
  return process.env.COOKIE_SECURE === "1";
}

function clientMeta(c: Context): { ip: string; userAgent: string } {
  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const userAgent = c.req.header("user-agent") || "";
  return { ip, userAgent };
}

function setPortalCookie(c: Context, sessionId: string, maxAgeSec: number): void {
  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "Lax",
    maxAge: maxAgeSec,
    path: "/",
  });
}

/**
 * Create a portal session for a Discord user and set the cookie.
 */
export async function createPortalSession(c: Context, discordUserId: string): Promise<string> {
  const { ip, userAgent } = clientMeta(c);
  const sessionId = await createAuthSession({
    kind: "portal",
    discordUserId,
    ip,
    userAgent,
  });
  setPortalCookie(c, sessionId, Math.floor(AUTH_SESSION_TTL_MS / 1000));
  c.set("portalDiscordUserId", discordUserId);
  return sessionId;
}

/**
 * Destroy the current portal session (DB + cookie).
 * Safe when session is missing/expired.
 */
export async function destroyPortalSession(c: Context): Promise<void> {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId) {
    try {
      await destroyAuthSession(sessionId, "portal");
    } catch {
      // still clear cookie
    }
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  c.set("portalDiscordUserId", undefined);
}

/**
 * Resolve portal session from cookie; refresh cookie TTL; set context cache.
 * Returns discordUserId or null.
 */
export async function resolvePortalDiscordUserId(c: Context): Promise<string | null> {
  const cached = c.get("portalDiscordUserId") as string | undefined;
  if (cached) return cached;

  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return null;

  try {
    const session = await getAuthSession(sessionId, "portal");
    if (!session?.discordUserId) return null;

    const maxAge = remainingTtlSeconds(session.createdAt);
    if (maxAge <= 0) {
      await destroyAuthSession(sessionId, "portal");
      return null;
    }

    setPortalCookie(c, sessionId, maxAge);
    void touchAuthSession(session.id, session.lastSeenAt);
    c.set("portalDiscordUserId", session.discordUserId);
    return session.discordUserId;
  } catch {
    return null;
  }
}

/**
 * Sync read of portal user id — set by auth middleware / createPortalSession.
 */
export function getPortalDiscordUserId(c: Context): string | null {
  const id = c.get("portalDiscordUserId") as string | undefined;
  return id || null;
}

/**
 * Check if the request has a valid portal session.
 */
export async function isPortalAuthenticated(c: Context): Promise<boolean> {
  return (await resolvePortalDiscordUserId(c)) !== null;
}
