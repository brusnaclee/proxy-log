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

export function formatCost(microDollars: number | undefined | null): string {
  if (!microDollars) return "$0.0000";
  return "$" + (microDollars / 1_000_000).toFixed(4);
}

// Format relative time in Indonesian
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  if (diffHour < 24) return `${diffHour} jam lalu`;
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return formatDateWIB(dateStr);
}

// Format date as DD/MM HH:mm WIB
export function formatDateWIB(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
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
