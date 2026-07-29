/** Format timestamps for Admin Log panels (WIB absolute + relative). */
export function formatLogTime(d?: string | Date | null): { absolute: string; relative: string } {
  if (!d) return { absolute: "—", relative: "" };
  try {
    const date = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(date.getTime())) return { absolute: String(d), relative: "" };
    const absolute =
      date.toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }) + " WIB";
    const diffMs = Date.now() - date.getTime();
    const sec = Math.round(Math.abs(diffMs) / 1000);
    const ago = diffMs >= 0;
    let relative = "";
    if (sec < 60) relative = `${sec}s`;
    else if (sec < 3600) relative = `${Math.floor(sec / 60)}m`;
    else if (sec < 86400) relative = `${Math.floor(sec / 3600)}h`;
    else relative = `${Math.floor(sec / 86400)}d`;
    relative = ago ? `${relative} ago` : `in ${relative}`;
    return { absolute, relative };
  } catch {
    return { absolute: String(d), relative: "" };
  }
}

export function formatLogTimeLine(d?: string | Date | null): string {
  const { absolute, relative } = formatLogTime(d);
  if (!relative) return absolute;
  return `${absolute} · ${relative}`;
}
