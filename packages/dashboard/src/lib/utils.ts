import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export function formatCost(microDollars: number | undefined | null): string {
  if (!microDollars) return "$0.00";
  return "$" + (microDollars / 1000000).toFixed(4);
}

export function formatDate(dateStr: string): string {
  const d = parseProxyDate(dateStr);
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const d = parseProxyDate(dateStr).getTime();
  const diff = now - d;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function parseProxyDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  // SQLite `datetime('now')` is stored as UTC without timezone suffix.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr.replace(" ", "T") + "Z");
  }
  return new Date(dateStr);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/**
 * Format a period string for chart display.
 * Daily: "2026-06-03" → "06/03"
 * Hourly: "2026-06-03 14:00" → "14:00 WIB"
 */
export function formatChartPeriod(v: string): string {
  if (!v) return v;
  if (v.includes(" ")) {
    // Hourly: already in WIB from server, show hour + WIB label
    return (v.split(" ")[1] || v) + " WIB";
  }
  // Daily: "YYYY-MM-DD" → "MM/DD"
  return v.split("-").slice(1).join("/");
}

/** True when key name already embeds Discord identity (main Discord-issued key). */
export function isDiscordPrimaryKeyLabel(
  apiKeyName?: string | null,
  discordUsername?: string | null,
  discordUserId?: string | null,
): boolean {
  const label = String(apiKeyName || "").trim();
  if (!label) return false;
  if (/^Discord[-_]/i.test(label)) return true;
  const uname = String(discordUsername || "").trim();
  const uid = String(discordUserId || "").trim();
  if (uname && uid && label.includes(uid) && label.toLowerCase().includes(uname.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * Admin Logs/Overview User column.
 * Primary Discord key → `username · id` (no double Discord-… prefix).
 * Extra portal/custom key → `KeyName · username · id`.
 */
export function formatLogUserDisplay(log: {
  apiKeyName?: string | null;
  discordUsername?: string | null;
  discordUserId?: string | null;
}): string {
  const label = String(log.apiKeyName || "").trim();
  const uname = String(log.discordUsername || "").trim();
  const uid = String(log.discordUserId || "").trim();
  const discordOnly =
    uname && uid ? `${uname} · ${uid}` : uname || uid || "";

  if (isDiscordPrimaryKeyLabel(label, uname, uid)) {
    return discordOnly || label || "—";
  }

  if (!label) return discordOnly || "—";
  if (discordOnly) return `${label} · ${discordOnly}`;
  return label;
}
