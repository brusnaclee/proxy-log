// cn utility
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// Format large numbers: 1234 -> "1.2K", 1234567 -> "1.2M"
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

/** Full input = prompt (billable) + cache. Optional Amanai credits meter. */
export function formatInputBreakdown(
  billable: number | undefined | null,
  cached: number | undefined | null,
  fullInput?: number | undefined | null,
  credits?: number | undefined | null,
): { total: string; label: string; compact: string; totalNum: number } {
  const cache = Math.max(0, Number(cached) || 0);
  const hasBillable = billable != null && Number.isFinite(Number(billable));
  const hasFull = fullInput != null && Number.isFinite(Number(fullInput));
  const billRaw = hasBillable ? Math.max(0, Number(billable)) : null;
  const fullRaw = hasFull ? Math.max(0, Number(fullInput)) : null;
  const cred = Math.max(0, Number(credits) || 0);

  let bill: number;
  let totalNum: number;
  if (billRaw != null) {
    bill = billRaw;
    const sum = bill + cache;
    // Ignore undersized fullInput (SSE raw: promptTokens=billable only)
    totalNum = fullRaw != null && fullRaw >= sum ? fullRaw : sum;
  } else if (fullRaw != null) {
    bill = fullRaw;
    totalNum = bill + cache;
  } else {
    bill = 0;
    totalNum = cache;
  }

  const total = formatNumber(totalNum);
  let label: string;
  let compact: string;
  if (cache > 0) {
    label = `${total} (${formatNumber(bill)} prompt + ${formatNumber(cache)} cache)`;
    compact = `${total} (${formatNumber(bill)} p + ${formatNumber(cache)} c)`;
  } else {
    label = total;
    compact = total;
  }
  if (cred > 0) {
    label = `${label} · ${formatNumber(cred)} credits`;
    compact = `${compact} · ${formatNumber(cred)} cr`;
  }
  return { totalNum, total, label, compact };
}

export function formatCost(microDollars: number | undefined | null): string {
  if (!microDollars) return "$0.0000";
  return "$" + (microDollars / 1_000_000).toFixed(4);
}

/** Absolute WIB clock (replaces "baru saja" / "X menit lalu" for clearer logs). */
export function formatRelativeTime(dateStr: string): string {
  return formatDateWIB(dateStr);
}

/** DD/MM/YYYY HH:mm:ss in Asia/Jakarta */
export function formatDateWIB(dateStr: string): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
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

// Human-readable status label
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

// Detailed status explanation
export function statusDetail(code: number): string {
  const details: Record<number, string> = {
    401: "Invalid or expired API key",
    403: "Access denied for this resource",
    429: "Too many requests, please wait",
    500: "Upstream provider internal error",
    502: "Upstream provider unavailable",
    503: "Service temporarily unavailable",
  };
  return details[code] || "";
}

// Mask API key for display
export function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + "..." + key.slice(-4);
  return key.slice(0, 8) + "..." + key.slice(-4);
}

// Status color class
export function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "text-green-400";
  if (code >= 400 && code < 500) {
    if (code === 429) return "text-orange-400";
    return "text-yellow-400";
  }
  if (code >= 500) return "text-red-400";
  return "text-muted-foreground";
}

// Status badge background color
export function statusBgColor(code: number): string {
  if (code >= 200 && code < 300) return "bg-green-400/10 text-green-400";
  if (code >= 400 && code < 500) {
    if (code === 429) return "bg-orange-400/10 text-orange-400";
    return "bg-yellow-400/10 text-yellow-400";
  }
  if (code >= 500) return "bg-red-400/10 text-red-400";
  return "bg-muted text-muted-foreground";
}
