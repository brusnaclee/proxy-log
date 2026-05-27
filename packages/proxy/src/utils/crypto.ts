import { createHash, randomBytes } from "crypto";

/**
 * Generate a random API key string in the format: sk-proxy-{random}
 */
export function generateApiKey(): string {
  const random = randomBytes(24).toString("base64url");
  return `sk-proxy-${random}`;
}

/**
 * Get the first 8 characters of a key for display purposes
 */
export function getKeyPrefix(key: string): string {
  return key.substring(0, 12);
}

/**
 * SHA-256 hash of a string
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Normalize a User-Agent string by stripping version numbers.
 * e.g. "Kilo-Code/7.3.12 ai-sdk/provider-utils/4.1" -> "Kilo-Code ai-sdk/provider-utils"
 * e.g. "Codex Desktop/0.133.0-alpha.1 (Windows 10.0.26200; x86_64)" -> "Codex Desktop (Windows; x86_64)"
 * This ensures the same app on the same machine generates the same fingerprint
 * even after IDE updates.
 */
function normalizeUserAgent(ua: string): string {
  return ua
    .replace(/\/[\d]+[\d.a-zA-Z_-]*/g, '')  // strip /version numbers
    .replace(/\d+\.\d+[\d.]*/g, '')           // strip remaining version-like numbers
    .replace(/\s+/g, ' ')                      // collapse whitespace
    .trim();
}

/**
 * Generate a device fingerprint from IP, User-Agent, and optionally Device ID.
 * - If a device ID header is provided, use it (stable across networks).
 * - Otherwise, use normalized User-Agent only (no IP at all).
 *   This way the same laptop on different WiFi networks = same device.
 */
export function generateFingerprint(ip: string, userAgent: string, deviceId: string = ""): string {
  if (deviceId) {
    return sha256(`device:${deviceId}:${normalizeUserAgent(userAgent)}`);
  }
  // Use ONLY normalized user-agent. No IP at all.
  // Same app on same OS = same device, regardless of network.
  return sha256(`ua:${normalizeUserAgent(userAgent)}`);
}

/**
 * Mask an API key for display: sk-proxy-abc → sk-proxy-abc...xxxx
 */
export function maskKey(key: string): string {
  if (key.length <= 12) return key + "...";
  return key.substring(0, 12) + "..." + key.substring(key.length - 4);
}

/**
 * Generate a random session ID
 */
export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}
