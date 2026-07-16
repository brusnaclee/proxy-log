import { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

// In-memory portal session store: sessionId -> { discordUserId, createdAt }
const portalSessions = new Map<string, { discordUserId: string; createdAt: number }>();

// Session expiry: 7 days
const PORTAL_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of portalSessions) {
    if (now - session.createdAt > PORTAL_SESSION_TTL) {
      portalSessions.delete(id);
    }
  }
}, 60 * 1000); // every minute

/**
 * Create a portal session for a Discord user and set the cookie.
 */
export function createPortalSession(c: Context, discordUserId: string): string {
  const sessionId = crypto.randomUUID();
  portalSessions.set(sessionId, { discordUserId, createdAt: Date.now() });

  setCookie(c, "portal_session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1",
    sameSite: "Lax",
    maxAge: PORTAL_SESSION_TTL / 1000,
    path: "/",
  });

  return sessionId;
}

/**
 * Destroy the current portal session.
 */
export function destroyPortalSession(c: Context): void {
  const sessionId = getCookie(c, "portal_session");
  if (sessionId) {
    portalSessions.delete(sessionId);
  }
  deleteCookie(c, "portal_session", { path: "/" });
}

/**
 * Get the Discord user ID from the current portal session, or null if invalid.
 */
export function getPortalDiscordUserId(c: Context): string | null {
  const sessionId = getCookie(c, "portal_session");
  if (!sessionId) return null;

  const session = portalSessions.get(sessionId);
  if (!session) return null;

  if (Date.now() - session.createdAt > PORTAL_SESSION_TTL) {
    portalSessions.delete(sessionId);
    return null;
  }

  return session.discordUserId;
}

/**
 * Check if the request has a valid portal session.
 */
export function isPortalAuthenticated(c: Context): boolean {
  return getPortalDiscordUserId(c) !== null;
}
