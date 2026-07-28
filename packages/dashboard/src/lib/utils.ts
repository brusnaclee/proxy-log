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

/** Full input = prompt (billable) + cache. label = readable, compact = short. */
export function formatInputBreakdown(
  billable: number | undefined | null,
  cached: number | undefined | null,
  fullInput?: number | undefined | null,
): { total: string; label: string; compact: string; totalNum: number } {
  const cache = Math.max(0, Number(cached) || 0);
  const hasBillable = billable != null && Number.isFinite(Number(billable));
  const hasFull = fullInput != null && Number.isFinite(Number(fullInput));
  const billRaw = hasBillable ? Math.max(0, Number(billable)) : null;
  const fullRaw = hasFull ? Math.max(0, Number(fullInput)) : null;

  // Prefer explicit billable+cache. If fullInput was passed but is smaller than
  // billable+cache (SSE raw: promptTokens=billable only), ignore fullInput.
  let bill: number;
  let totalNum: number;
  if (billRaw != null) {
    bill = billRaw;
    const sum = bill + cache;
    totalNum = fullRaw != null && fullRaw >= sum ? fullRaw : sum;
  } else if (fullRaw != null) {
    // Missing billable (legacy/SSE): treat fullInput as billable when cache present
    bill = cache > 0 ? fullRaw : fullRaw;
    totalNum = bill + cache;
  } else {
    bill = 0;
    totalNum = cache;
  }

  const total = formatNumber(totalNum);
  if (cache > 0) {
    return {
      totalNum,
      total,
      label: `${total} (${formatNumber(bill)} prompt + ${formatNumber(cache)} cache)`,
      compact: `${total} (${formatNumber(bill)} p + ${formatNumber(cache)} c)`,
    };
  }
  return { totalNum, total, label: total, compact: total };
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

/** Absolute WIB clock time (replaces "5s ago" style for clearer logs). */
export function formatRelativeTime(dateStr: string): string {
  return formatDate(dateStr);
}

function parseProxyDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  // SQLite `datetime('now')` is stored as UTC without timezone suffix.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr.replace(" ", "T") + "Z");
  }
  return new Date(dateStr);
}

/** Clipboard helper — works on HTTP admin (no secure-context clipboard API). */
export async function copyToClipboard(text: string): Promise<void> {
  const value = String(text || "");
  if (!value) throw new Error("Nothing to copy");

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    /* fall through */
  }

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("Copy failed");
}

export function statusLabel(code: number): string {
  if (code >= 200 && code < 300) return "OK";
  const labels: Record<number, string> = {
    401: "Unauthorized",
    403: "Forbidden",
    429: "Rate Limited",
    500: "Server Error",
    502: "Bad Gateway",
    503: "Unavailable",
  };
  return labels[code] || `HTTP ${code}`;
}

export function statusDetail(code: number): string {
  const details: Record<number, string> = {
    401: "Invalid or expired API key",
    403: "Access denied for this resource",
    429: "Too many requests — wait for the window reset",
    500: "Upstream provider internal error",
    502: "Upstream provider unavailable or returned an invalid response",
    503: "Service temporarily unavailable",
  };
  return details[code] || "";
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
