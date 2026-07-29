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

function headerFirst(c: Context, name: string): string {
  const v = c.req.header(name);
  if (!v) return "";
  return v.split(",")[0].trim();
}

function stripIpv6Mapped(ip: string): string {
  return ip.replace(/^::ffff:/i, "").trim();
}

function isLoopback(ip: string): boolean {
  const s = stripIpv6Mapped(ip).toLowerCase();
  return !s || s === "::1" || s === "127.0.0.1" || s === "localhost";
}

/** Best-effort client IP from proxy / CDN headers, then socket. */
export function requestClientIp(c: Context): string {
  const candidates = [
    headerFirst(c, "cf-connecting-ip"),
    headerFirst(c, "true-client-ip"),
    headerFirst(c, "x-real-ip"),
    headerFirst(c, "x-forwarded-for"),
  ]
    .map(stripIpv6Mapped)
    .filter(Boolean);

  for (const ip of candidates) {
    if (!isLoopback(ip)) return ip;
  }
  if (candidates[0]) return candidates[0];

  try {
    const raw =
      (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket
        ?.remoteAddress ||
      (c.req.raw as unknown as { socket?: { remoteAddress?: string } })?.socket?.remoteAddress ||
      "";
    const addr = stripIpv6Mapped(String(raw || ""));
    if (addr) return addr;
  } catch {
    /* ignore */
  }

  return "unknown";
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

export type ClientHintInput = {
  platform?: string;
  mobile?: boolean;
  label?: string;
  timezone?: string;
  languages?: string;
};

export function parseSessionClientMeta(
  c: Context,
  clientHint?: ClientHintInput | null,
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
        (userAgent.match(/^[^\s/]+/) || ["ua"])[0],
        clientHint?.timezone || "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);

  const labelParts = [
    clientHint?.label && String(clientHint.label).trim(),
    clientHint?.timezone && String(clientHint.timezone).trim(),
    clientHint?.languages && String(clientHint.languages).trim().slice(0, 40),
  ].filter(Boolean) as string[];

  const clientLabel =
    labelParts.length > 0
      ? labelParts.join(" · ").slice(0, 80)
      : clientHint?.platform
        ? String(clientHint.platform).slice(0, 80)
        : null;

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
