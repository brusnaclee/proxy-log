import { createHash } from "crypto";
import type { Context } from "hono";

export type DeviceClass = "mobile" | "desktop" | "tablet" | "bot" | "unknown";

export interface SessionClientMeta {
  ip: string;
  userAgent: string;
  country: string | null;
  deviceClass: DeviceClass;
  osName: string | null;
  clientName: string | null;
  fingerprint: string;
  clientLabel: string | null;
}

/** Best-effort client IP from proxy headers. */
export function requestClientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function requestCountry(c: Context): string | null {
  const cf = c.req.header("cf-ipcountry")?.trim().toUpperCase();
  if (cf && cf !== "XX" && cf !== "T1") return cf;
  const vercel = c.req.header("x-vercel-ip-country")?.trim().toUpperCase();
  if (vercel) return vercel;
  return null;
}

function detectOs(ua: string, chPlatform?: string | null): string | null {
  const p = (chPlatform || "").replace(/"/g, "");
  if (p) {
    if (/windows/i.test(p)) return "Windows";
    if (/mac|darwin/i.test(p)) return "macOS";
    if (/android/i.test(p)) return "Android";
    if (/ios|iphone|ipad/i.test(p)) return "iOS";
    if (/linux/i.test(p)) return "Linux";
    if (/chrome os/i.test(p)) return "Chrome OS";
  }
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/windows nt/i.test(ua)) return "Windows";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "Chrome OS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

function detectClient(ua: string): string | null {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return "Safari";
  if (/curl\//i.test(ua)) return "curl";
  if (/postman/i.test(ua)) return "Postman";
  return null;
}

function detectDeviceClass(ua: string, chMobile?: string | null): DeviceClass {
  if (/bot|crawler|spider|slurp/i.test(ua)) return "bot";
  const mobileHint = String(chMobile || "").replace(/"/g, "");
  if (mobileHint === "?1" || mobileHint === "1") return "mobile";
  if (/ipad|tablet|kindle|silk/i.test(ua)) return "tablet";
  if (/mobi|iphone|android.*mobile|windows phone/i.test(ua)) return "mobile";
  if (ua.trim()) return "desktop";
  return "unknown";
}

export function parseSessionClientMeta(
  c: Context,
  clientHint?: { platform?: string; mobile?: boolean; label?: string } | null,
): SessionClientMeta {
  const ip = requestClientIp(c);
  const userAgent = c.req.header("user-agent") || "";
  const country = requestCountry(c);
  const chPlatform = c.req.header("sec-ch-ua-platform") || clientHint?.platform || null;
  const chMobile =
    c.req.header("sec-ch-ua-mobile") ||
    (clientHint?.mobile === true ? "?1" : clientHint?.mobile === false ? "?0" : null);

  const osName = detectOs(userAgent, chPlatform);
  const clientName = detectClient(userAgent);
  const deviceClass = detectDeviceClass(userAgent, chMobile);
  const fingerprint = createHash("sha256")
    .update(
      [
        osName || "unknown",
        chPlatform || "",
        clientName || "unknown",
        deviceClass,
        // coarse UA family only — avoid raw UA entropy that rotates often
        (userAgent.match(/^[^\s/]+/) || ["ua"])[0],
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);

  const clientLabel =
    (clientHint?.label && String(clientHint.label).trim().slice(0, 80)) ||
    (clientHint?.platform ? String(clientHint.platform).slice(0, 80) : null);

  return {
    ip,
    userAgent: userAgent.slice(0, 512),
    country,
    deviceClass,
    osName,
    clientName,
    fingerprint,
    clientLabel,
  };
}
