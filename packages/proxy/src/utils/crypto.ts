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
 */
function normalizeUserAgent(ua: string): string {
  return ua
    .replace(/\/[\d]+[\d.a-zA-Z_-]*/g, "")
    .replace(/\d+\.\d+[\d.]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * OS + arch bucket for machine identity (ignores IDE / client product name).
 *
 * WHY: Cursor / Kilo / OpenCode / Claude Code each send a different User-Agent.
 * We intentionally drop the product name so they map to one slot on the same PC.
 * We do NOT have a real hardware UUID from most IDEs — OS+arch is the best
 * stable signal that does not flip when WiFi or IDE changes.
 */
export function normalizeMachineOs(os: string): string {
  const o = String(os || "").toLowerCase().replace(/\s+/g, "_");
  if (!o || o === "unknown") return "unknown";
  if (/^windows(_nt)?$|^win/.test(o)) return "windows";
  if (/^macintosh$|^mac_os(_x)?$|^macos$|^darwin$|^osx$/.test(o)) return "macos";
  if (/^cros$|^chrome_?os$/.test(o)) return "chromeos";
  if (/^iphone$|^ipad$|^ios$/.test(o)) return "ios";
  if (/^android$/.test(o)) return "android";
  if (/^linux$/.test(o)) return "linux";
  return o.slice(0, 32);
}

export function normalizeMachineArch(arch: string): string {
  const a = String(arch || "").toLowerCase();
  if (!a) return "";
  if (/^(x86_64|amd64|win64|wow64|x64)$/.test(a)) return "x64";
  if (/^(aarch64|arm64)$/.test(a)) return "arm64";
  if (/^(i686|i386|x86)$/.test(a)) return "x86";
  return a.slice(0, 16);
}

export function extractMachineHint(
  userAgent: string,
  osDetected?: string | null,
): string {
  const ua = String(userAgent || "");
  const osFromUa = ua.match(
    /windows nt|windows|macintosh|mac os x|mac os|linux|android|iphone|ipad|cros/i,
  )?.[0];
  const archMatch = ua.match(
    /x86_64|win64|wow64|amd64|arm64|aarch64|x64|i686|i386/i,
  );

  let osRaw = (osFromUa || "").toLowerCase().replace(/\s+/g, "_");
  if (!osRaw && osDetected) {
    const o = String(osDetected).toLowerCase();
    if (/win/.test(o)) osRaw = "windows";
    else if (/mac|darwin|osx/.test(o)) osRaw = "macintosh";
    else if (/linux/.test(o)) osRaw = "linux";
    else if (/android/.test(o)) osRaw = "android";
    else if (/ios|iphone|ipad/.test(o)) osRaw = "iphone";
    else osRaw = o.replace(/\s+/g, "_").slice(0, 32);
  }
  const os = normalizeMachineOs(osRaw || "unknown");
  const arch = normalizeMachineArch(archMatch?.[0] || "");
  return `${os}:${arch}`;
}

/**
 * Canonical device fingerprint = machine bucket only.
 *
 * Intentionally ignores:
 * - IP (WiFi / VPN flips)
 * - full User-Agent product name (IDE switches)
 * - x-device-id header (many clients send it intermittently → would split slots)
 *
 * Same laptop on Windows x64 = one fingerprint across all IDEs.
 * Tradeoff: two different Windows x64 PCs look like one machine (acceptable for
 * personal Discord keys with maxDevices=1; abuse is handled by rate limits).
 */
export function generateFingerprint(
  ip: string,
  userAgent: string,
  deviceId: string = "",
  osDetected?: string | null,
): string {
  void ip;
  void deviceId;
  const machine = extractMachineHint(userAgent, osDetected);
  if (machine && machine !== "unknown:") {
    return sha256(`machine:${machine}`);
  }
  // Many IDEs (Kilo / Cline / OpenCode / Roo) omit OS from UA entirely.
  // Hashing the product name would split one PC into many device slots.
  // Keep a single shared bucket per key for OS-less clients.
  return sha256("machine:unknown:shared");
}

/** Legacy fingerprints we may still find in DB from older eras. */
export function legacyFingerprintCandidates(
  userAgent: string,
  deviceId: string = "",
): string[] {
  const out: string[] = [];
  if (deviceId) {
    out.push(sha256(`device:${deviceId}`));
    out.push(sha256(`device:${deviceId}:${normalizeUserAgent(userAgent)}`));
  }
  out.push(sha256(`ua:${normalizeUserAgent(userAgent)}`));
  return out;
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
