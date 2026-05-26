/**
 * export-xlsx.ts
 * Professional XLSX export library for AI Proxy Gateway Dashboard.
 * Uses SheetJS (xlsx) — generates Excel files with:
 *   • Bold frozen header rows
 *   • Auto-filter dropdowns on every column
 *   • Auto-fitted column widths
 *   • Alternating row shading
 *   • Multiple sheets per workbook
 *   • Clean metadata sheet as cover page
 */

import * as XLSX from "xlsx";

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  headerBg:   "1E293B", // slate-800  – dark header
  headerFg:   "F8FAFC", // slate-50   – white text
  metaBg:     "0F172A", // slate-900  – cover bg
  metaFg:     "94A3B8", // slate-400  – muted text
  metaValFg:  "F1F5F9", // slate-100  – value text
  rowAlt:     "F1F5F9", // slate-100  – alternate row
  rowWhite:   "FFFFFF",
  accentBg:   "818CF8", // indigo-400 – accent
  border:     "CBD5E1", // slate-300
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCell(
  value: any,
  opts: {
    bold?: boolean;
    fg?: string;
    bg?: string;
    sz?: number;
    italic?: boolean;
    align?: "left" | "center" | "right";
    border?: boolean;
    numFmt?: string;
    wrap?: boolean;
  } = {},
): XLSX.CellObject {
  let t: XLSX.ExcelDataType = "s";
  let v: any = value;

  if (value === null || value === undefined || value === "") {
    t = "z"; v = undefined;
  } else if (typeof value === "number" && isFinite(value)) {
    t = "n"; v = value;
  } else if (typeof value === "boolean") {
    t = "b"; v = value;
  } else {
    t = "s"; v = String(value);
  }

  const cell: XLSX.CellObject = { t, v };

  const style: any = {};

  if (opts.bold || opts.fg || opts.bg || opts.sz || opts.italic || opts.align !== undefined) {
    style.font = {
      ...(opts.bold  ? { bold: true }          : {}),
      ...(opts.italic? { italic: true }         : {}),
      ...(opts.sz    ? { sz: opts.sz }          : { sz: 10 }),
      ...(opts.fg    ? { color: { rgb: opts.fg }} : {}),
    };
  }

  if (opts.bg) {
    style.fill = { patternType: "solid", fgColor: { rgb: opts.bg } };
  }

  if (opts.align !== undefined) {
    style.alignment = { horizontal: opts.align, wrapText: !!opts.wrap, vertical: "center" };
  } else if (opts.wrap) {
    style.alignment = { wrapText: true, vertical: "center" };
  }

  if (opts.border) {
    const b = { style: "thin", color: { rgb: C.border } };
    style.border = { top: b, bottom: b, left: b, right: b };
  }

  if (opts.numFmt) cell.z = opts.numFmt;

  if (Object.keys(style).length) (cell as any).s = style;
  return cell;
}

/** Compute column widths from header labels and data */
function colWidths(headers: string[], rows: any[][]): XLSX.ColInfo[] {
  return headers.map((h, i) => {
    const maxData = rows.reduce((m, r) => {
      const len = String(r[i] ?? "").length;
      return len > m ? len : m;
    }, 0);
    const w = Math.min(Math.max(h.length, maxData, 8) + 2, 60);
    return { wch: w };
  });
}

function isoNow(): string {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }) + " WIB";
}

// ─── Sheet builders ───────────────────────────────────────────────────────────

/**
 * Build a data sheet with bold frozen header + auto-filter + alternating rows.
 */
export function buildSheet(
  headers: string[],
  rows: any[][],
  opts: { note?: string } = {},
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let r = 0;

  // Optional note row above header
  if (opts.note) {
    XLSX.utils.sheet_add_aoa(ws, [[opts.note]], { origin: `A${r + 1}` });
    const noteCell = ws[`A${r + 1}`];
    if (noteCell) (noteCell as any).s = {
      font: { sz: 9, italic: true, color: { rgb: "64748B" } },
    };
    r++;
  }

  const headerRow = r;

  // Header row
  headers.forEach((h, c) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    ws[addr] = makeCell(h, {
      bold: true, fg: C.headerFg, bg: C.headerBg,
      sz: 10, align: "left", border: true,
    });
  });
  r++;

  // Data rows
  rows.forEach((dataRow, rowIdx) => {
    const isAlt = rowIdx % 2 === 1;
    const bg = isAlt ? C.rowAlt : C.rowWhite;
    dataRow.forEach((val, c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] = makeCell(val, {
        bg, align: typeof val === "number" ? "right" : "left",
        sz: 10, border: true,
      });
    });
    r++;
  });

  // Sheet range
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: r - 1, c: headers.length - 1 } });

  // Freeze first header row
  ws["!freeze"] = { xSplit: 0, ySplit: headerRow + 1, topLeftCell: XLSX.utils.encode_cell({ r: headerRow + 1, c: 0 }), activePane: "bottomLeft", state: "frozen" };

  // Auto-filter on header row
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: headers.length - 1 } }) };

  // Column widths
  ws["!cols"] = colWidths(headers, rows);

  return ws;
}

/**
 * Build a cover/metadata sheet.
 * meta: array of [label, value] pairs
 */
function buildCoverSheet(
  title: string,
  meta: [string, any][],
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};

  // Title
  ws["A1"] = makeCell(title, { bold: true, fg: C.metaValFg, bg: C.metaBg, sz: 14, align: "left" });
  ws["B1"] = makeCell("", { bg: C.metaBg });

  let r = 2;
  for (const [label, value] of meta) {
    ws[`A${r}`] = makeCell(label, { bold: true, fg: C.metaFg, bg: C.metaBg, sz: 10, align: "right" });
    ws[`B${r}`] = makeCell(value, { fg: C.metaValFg, bg: C.metaBg, sz: 10, align: "left" });
    r++;
  }

  // Empty footer rows with bg
  for (let i = r; i < r + 3; i++) {
    ws[`A${i}`] = makeCell("", { bg: C.metaBg });
    ws[`B${i}`] = makeCell("", { bg: C.metaBg });
  }

  ws["!ref"] = `A1:B${r + 2}`;
  ws["!cols"] = [{ wch: 20 }, { wch: 55 }];
  return ws;
}

// ─── Download helper ──────────────────────────────────────────────────────────

function download(wb: XLSX.WorkBook, filename: string) {
  const name = filename.endsWith(".xlsx") ? filename : filename + ".xlsx";
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ─── Public export functions ──────────────────────────────────────────────────

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: any[][];
  note?: string;
}

/**
 * Main multi-sheet export function.
 * Creates workbook with a cover sheet + one sheet per XlsxSheet.
 */
export function exportXlsx(
  sheets: XlsxSheet[],
  filename: string,
  meta: { title: string; period?: string; keyName?: string } = { title: "AI Proxy Gateway Export" },
) {
  const wb = XLSX.utils.book_new();

  // Cover sheet
  const coverMeta: [string, any][] = [
    ["Exported At", isoNow()],
    ["Sheets",      sheets.length],
  ];
  if (meta.keyName)  coverMeta.splice(1, 0, ["API Key", meta.keyName]);
  if (meta.period)   coverMeta.splice(1, 0, ["Period", meta.period]);

  const coverWs = buildCoverSheet(meta.title, coverMeta);
  XLSX.utils.book_append_sheet(wb, coverWs, "Info");

  // Data sheets
  for (const s of sheets) {
    const ws = buildSheet(s.headers, s.rows, { note: s.note });
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); // Excel sheet name max 31 chars
  }

  download(wb, filename);
}

// ─── Formatters (reused by callers) ──────────────────────────────────────────

export function fmtCost(v: any): string {
  const n = Number(v);
  if (isNaN(n) || n === 0) return "$0.00";
  const d = n / 1_000_000;
  return d >= 1 ? `$${d.toFixed(2)}` : `$${d.toFixed(5)}`;
}

export function fmtMs(v: any): string {
  const n = Number(v);
  if (isNaN(n) || !v) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n}ms`;
}

// ─── Backward compat shim (pages still import from export-csv) ────────────────
// Keep old CSV functions alive so we don't need to change every caller at once
export interface CsvSection { title: string; headers: string[]; rows: any[][]; notes?: string }
export function exportCsvMultiSection(
  sections: CsvSection[], filename: string, period?: string, keyName?: string,
) {
  exportXlsx(
    sections.map(s => ({ name: s.title.slice(0, 31), headers: s.headers, rows: s.rows, note: s.notes })),
    filename.replace(/\.csv$/i, ""),
    { title: "AI Proxy Gateway Export", period, keyName },
  );
}
export function exportCsvSimple(
  headers: string[], rows: any[][], filename: string, period?: string, keyName?: string,
) {
  exportXlsx(
    [{ name: filename.replace(/[-_]/g, " ").replace(/\.csv$/i, "").slice(0, 31), headers, rows }],
    filename.replace(/\.csv$/i, ""),
    { title: "AI Proxy Gateway Export", period, keyName },
  );
}

// Re-export section builders (used by individual pages)
export function buildLogsSection(logs: any[], title = "Request Logs"): XlsxSheet {
  return {
    name: title.slice(0, 31),
    note: "is_counted=Yes means a real user prompt (not IDE retry or sub-agent)",
    headers: [
      "Timestamp", "Model", "Provider", "IDE", "OS", "IP Address",
      "Session ID", "Context Event",
      "Input Tokens", "Output Tokens", "Total Tokens", "Context Tokens",
      "Est. Cost", "Latency", "HTTP Status", "Counted", "User Prompt Preview",
    ],
    rows: logs.map(l => [
      l.createdAt || "",
      l.model || "",
      l.provider || "",
      l.ideDetected || "",
      l.osDetected || "",
      l.ipAddress || "",
      l.sessionId || "",
      l.contextEvent || "",
      typeof l.promptTokens === "number" ? l.promptTokens : (Number(l.promptTokens) || 0),
      typeof l.completionTokens === "number" ? l.completionTokens : (Number(l.completionTokens) || 0),
      typeof l.totalTokens === "number" ? l.totalTokens : (Number(l.totalTokens) || 0),
      Number(l.contextTokensBefore ?? l.estimatedContextLength ?? 0),
      fmtCost(l.estimatedCost),
      fmtMs(l.latencyMs),
      l.statusCode || "",
      l.isCountedRequest ? "Yes" : "No",
      String(l.requestPreview || "").slice(0, 200),
    ]),
  };
}

export function buildSessionsSection(sessions: any[], title = "Chat Sessions"): XlsxSheet {
  return {
    name: title.slice(0, 31),
    note: "Each row = one conversation session",
    headers: [
      "Session Name", "Session ID", "Device (short)", "IDE", "Model (last)",
      "User Prompts", "Total Tokens", "Est. Cost", "First Seen", "Last Seen",
    ],
    rows: sessions.map(s => [
      s.sessionName || "Untitled Chat",
      s.sessionId || "",
      s.deviceFingerprint ? s.deviceFingerprint.substring(0, 12) + "..." : "",
      s.ideDetected || "",
      s.model || "",
      Number(s.requestCount) || 0,
      Number(s.totalTokens) || 0,
      fmtCost(s.estimatedCost),
      s.firstSeenAt || "",
      s.lastSeenAt || "",
    ]),
  };
}

export function buildModelsSection(models: any[], title = "Models by Usage"): XlsxSheet {
  return {
    name: title.slice(0, 31),
    headers: ["Model", "Requests", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost", "Avg Latency"],
    rows: models.map(m => [
      m.model || "",
      Number(m.requests ?? m.count) || 0,
      Number(m.tokens) || 0,
      Number(m.promptTokens) || 0,
      Number(m.completionTokens) || 0,
      fmtCost(m.estimatedCost),
      m.avgLatency ? fmtMs(m.avgLatency) : "",
    ]),
  };
}

export function buildTimelineSection(turns: any[], title = "Conversation Timeline"): XlsxSheet {
  return {
    name: title.slice(0, 31),
    note: "Each row = one user turn. Server retries are merged (see Attempts column).",
    headers: [
      "Turn #", "Timestamp", "Model", "Context Event", "Tools Used",
      "Input Tokens", "Output Tokens", "Total Tokens", "Est. Cost",
      "Latency", "HTTP Status", "Attempts", "User Prompt", "Assistant Reply",
    ],
    rows: turns.map((t, i) => [
      i + 1,
      t.lastSeenAt || t.createdAt || "",
      t.model || "",
      t.contextEvent || "append",
      (t.toolsUsed || []).join(", "),
      Number(t.promptTokens) || 0,
      Number(t.completionTokens) || 0,
      Number(t.totalTokens) || 0,
      fmtCost(t.estimatedCost),
      fmtMs(t.latencyMs),
      t.statusCode || "",
      t.attemptCount || 1,
      String(t.requestPreview || "").slice(0, 300),
      String(t.responsePreview || "").slice(0, 300),
    ]),
  };
}
