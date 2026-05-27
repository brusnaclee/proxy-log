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
 * Generate a device fingerprint from IP, User-Agent, and optionally Device ID
 * If a true device ID is provided, use it instead of IP to allow tracking across networks.
 */
export function generateFingerprint(ip: string, userAgent: string, deviceId: string = ""): string {
  if (deviceId) {
    return sha256(`device:${deviceId}:${userAgent}`);
  }
  // Use IP subnet (first 3 octets) instead of full IP to group same-network devices
  const ipSubnet = ip.includes(".") ? ip.split(".").slice(0, 3).join(".") : ip;
  return sha256(`ip:${ipSubnet}:${userAgent}`);
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
