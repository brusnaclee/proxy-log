import { createHash, randomBytes } from "crypto";

/**
 * Generate a random API key string in the format: sk-proxy-{random}
 */
export function generateApiKey(): string {
  const random = randomBytes(24).toString("base64url");
  return `sk-proxy-${random}`;
}

export function generateTrialApiKey(): string {
  const random = randomBytes(24).toString("base64url");
  return `trial_${random}`;
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
 * OS + arch bucket for machine identity (ignores IDE / client product name).
 * Prevents false key rotation when the same laptop opens Cline then Cursor.
 */
export function extractMachineHint(userAgent: string): string {
  const ua = String(userAgent || '');
  const osMatch = ua.match(/windows nt|windows|macintosh|mac os x|mac os|linux|android|iphone|ipad|cros/i);
  const archMatch = ua.match(/x86_64|win64|wow64|amd64|arm64|aarch64|x64|i686|i386/i);
  const os = (osMatch?.[0] || 'unknown').toLowerCase().replace(/\s+/g, '_');
  const arch = (archMatch?.[0] || '').toLowerCase();
  return `${os}:${arch}`;
}

/**
 * Generate a device fingerprint from IP, User-Agent, and optionally Device ID.
 * - If a device ID header is provided, use it alone (stable across IDEs/networks).
 * - Otherwise, use OS+arch machine bucket (multi-IDE on same OS/arch = one device).
 *   IP is never used (WiFi flips must not rotate keys).
 */
export function generateFingerprint(ip: string, userAgent: string, deviceId: string = ""): string {
  void ip; // kept for call-site compatibility; intentionally unused
  if (deviceId) {
    return sha256(`device:${deviceId}`);
  }
  const machine = extractMachineHint(userAgent);
  if (machine && machine !== 'unknown:') {
    return sha256(`machine:${machine}`);
  }
  // Last resort: normalized UA (legacy-ish) when we can't parse OS
  return sha256(`ua:${normalizeUserAgent(userAgent)}`);
}

/**
 * Mask an API key for display: sk-proxy-abc → sk-proxy-abc...xxxx
 */
export function maskKey(key: string): string {
  if (key.length <= 12) return key + "...";
  return key.substring(0, 12) + "..." + key.substring(key.length - 4);
}

/** Strip common paste artifacts from provider upstream keys. */
export function sanitizeProviderApiKey(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^key:\s*/i, "");
}

/**
 * Generate a random session ID
 */
export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}
