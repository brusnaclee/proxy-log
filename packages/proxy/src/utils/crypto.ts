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
 * OS + arch bucket for the machine half of a device slot fingerprint.
 * Combined with normalized IDE name in generateFingerprint — different IDEs
 * are different slots even on the same OS/arch.
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
 * Canonical device fingerprint = machine bucket + IDE slot.
 *
 * - Same IDE on same OS/arch → same slot (UA version bumps do not split).
 * - Different IDE (Cursor vs Cline) → different slot (maxDevices counts IDEs).
 * - IP and raw UA product version are ignored.
 */
export function generateFingerprint(
  ip: string,
  userAgent: string,
  deviceId: string = "",
  osDetected?: string | null,
  ideName?: string | null,
): string {
  void ip;
  void deviceId;
  const machine = extractMachineHint(userAgent, osDetected);
  const ide = String(ideName || "unknown")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 64) || "unknown";
  const machinePart =
    machine && machine !== "unknown:" ? machine : "unknown:shared";
  return sha256(`slot:${machinePart}|ide:${ide}`);
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
