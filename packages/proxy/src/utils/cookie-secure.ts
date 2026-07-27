import type { Context } from "hono";

/**
 * Decide Secure cookie flag from the *client-facing* protocol.
 *
 * Admin dashboard runs on Vite HTTP (:5173) and proxies /admin → proxy.
 * Forcing Secure=1 there makes browsers drop the session cookie → login loop.
 * Portal on https://api.tokito.xyz should still get Secure cookies via
 * X-Forwarded-Proto / HTTPS.
 *
 * COOKIE_SECURE=0 → never Secure
 * COOKIE_SECURE=1 → Secure only when proto is unknown (fallback)
 * otherwise → follow request proto
 */
export function shouldUseSecureCookies(c: Context): boolean {
  if (process.env.COOKIE_SECURE === "0") return false;

  const xf = (
    c.req.header("x-forwarded-proto") ||
    c.req.header("x-forwarded-protocol") ||
    ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (xf === "https") return true;
  if (xf === "http") return false;

  try {
    if (new URL(c.req.url).protocol === "https:") return true;
    if (new URL(c.req.url).protocol === "http:") return false;
  } catch {
    /* ignore */
  }

  return process.env.COOKIE_SECURE === "1";
}
