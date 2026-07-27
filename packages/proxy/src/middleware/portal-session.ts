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

const COOKIE_NAME = "portal_session";

startAuthSessionPurgeJob();

function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === "1";
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

export function getPortalSessionRawId(c: Context): string | undefined {
  return getCookie(c, COOKIE_NAME);
}

/**
 * Create a portal session for a Discord user and set the cookie.
 */
export async function createPortalSession(
  c: Context,
  discordUserId: string,
  clientHint?: { platform?: string; mobile?: boolean; label?: string } | null,
): Promise<string> {
  const meta = parseSessionClientMeta(c, clientHint);
  const sessionId = await createAuthSession({
    kind: "portal",
    discordUserId,
    meta,
  });
  setPortalCookie(c, sessionId, Math.floor(AUTH_SESSION_TTL_MS / 1000));
  return sessionId;
}

/**
 * Destroy the current portal session (DB + cookie).
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
}

/**
 * Resolve portal session from cookie; refresh cookie TTL; set context cache.
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
    void touchAuthSession(session.id, session.lastSeenAt, {
      ip: parseSessionClientMeta(c).ip,
    });
    c.set("portalDiscordUserId", session.discordUserId);
    return session.discordUserId;
  } catch {
    return null;
  }
}

export function getPortalDiscordUserId(c: Context): string | null {
  return (c.get("portalDiscordUserId") as string | undefined) || null;
}

/**
 * Check if the request has a valid portal session.
 */
export async function isPortalAuthenticated(c: Context): Promise<boolean> {
  return !!(await resolvePortalDiscordUserId(c));
}
