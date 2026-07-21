/**
 * export-xlsx.ts
 * Professional XLSX export library for AI Proxy Gateway Dashboard.
 * Uses ExcelJS — full styling support (colors, borders, freeze, tab colors).
 */

import ExcelJS from "exceljs";

// ─── Colour palette (ARGB with FF prefix) ─────────────────────────────────────
const C = {
  headerBg:   "FF1E293B",
  headerFg:   "FFF8FAFC",
  rowAlt:     "FFF8FAFC",
  rowWhite:   "FFFFFFFF",
  coverBg:    "FF0F172A",
  coverLabel: "FF94A3B8",
  coverValue: "FFF1F5F9",
  border:     "FFE2E8F0",
  tabIndigo:  "FF6366F1",
  tabBlue:    "FF3B82F6",
  tabEmerald: "FF10B981",
  tabAmber:   "FFF59E0B",
  tabRose:    "FFF43F5E",
};

const thinBorder = { style: "thin" as const, color: { argb: C.border } };
const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const bottomBorder = { bottom: thinBorder };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colWidths(headers: string[], rows: any[][]): number[] {
  return headers.map((h, i) => {
    const maxData = rows.reduce((m, r) => {
      const len = String(r[i] ?? "").length;
      return len > m ? len : m;
    }, 0);
    return Math.min(Math.max(h.length, maxData, 8) + 2, 60);
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

function tabColorForSheet(name: string): { argb: string } {
  const lower = name.toLowerCase();
  if (lower.includes("info") || lower.includes("summary") || lower.includes("overview")) {
    return { argb: C.tabIndigo };
  }
  if (lower.includes("log") || lower.includes("request")) {
    return { argb: C.tabBlue };
  }
  if (lower.includes("model")) {
    return { argb: C.tabEmerald };
  }
  if (lower.includes("session") || lower.includes("timeline") || lower.includes("chat")) {
    return { argb: C.tabAmber };
  }
  if (lower.includes("monitor") || lower.includes("analytic")) {
    return { argb: C.tabRose };
  }
  return { argb: C.tabIndigo };
}

function applyHeaderStyle(cell: ExcelJS.Cell) {
  cell.font = { bold: true, color: { argb: C.headerFg }, size: 10, name: "Calibri" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerBg } };
  cell.border = allBorders;
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function applyDataStyle(cell: ExcelJS.Cell, val: any, isAlt: boolean) {
  const bg = isAlt ? C.rowAlt : C.rowWhite;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  cell.font = { size: 10, name: "Calibri" };
  cell.border = bottomBorder;
  cell.alignment = {
    vertical: "middle",
    horizontal: typeof val === "number" ? "right" : "left",
  };
}

// ─── Sheet builders ───────────────────────────────────────────────────────────

function buildCoverSheet(wb: ExcelJS.Workbook, title: string, meta: [string, any][]) {
  const ws = wb.addWorksheet("Info", {
    properties: { tabColor: { argb: C.tabIndigo } },
  });

  ws.mergeCells("A1:D1");
  const titleCell = ws.getCell("A1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 16, color: { argb: C.coverValue }, name: "Calibri" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.coverBg } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 28;

  let r = 3;
  for (const [label, value] of meta) {
    const labelCell = ws.getCell(`A${r}`);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 10, color: { argb: C.coverLabel }, name: "Calibri" };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.coverBg } };
    labelCell.alignment = { vertical: "middle", horizontal: "right" };

    const valueCell = ws.getCell(`B${r}`);
    valueCell.value = value ?? "";
    valueCell.font = { bold: true, size: 10, color: { argb: C.coverValue }, name: "Calibri" };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.coverBg } };
    valueCell.alignment = { vertical: "middle", horizontal: "left" };

    ws.getCell(`C${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.coverBg } };
    ws.getCell(`D${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.coverBg } };
    ws.getRow(r).height = 20;
    r++;
  }

  for (let i = r; i < r + 2; i++) {
    for (const col of ["A", "B", "C", "D"]) {
      ws.getCell(`${col}${i}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.coverBg } };
    }
  }

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 55;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 10;
}

function buildDataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: any[][],
  opts: { note?: string } = {},
) {
  const sheetName = name.slice(0, 31);
  const ws = wb.addWorksheet(sheetName, {
    properties: { tabColor: tabColorForSheet(sheetName) },
  });

  let startRow = 1;

  if (opts.note) {
    ws.mergeCells(1, 1, 1, headers.length);
    const noteCell = ws.getCell(1, 1);
    noteCell.value = opts.note;
    noteCell.font = { italic: true, size: 9, color: { argb: "FF64748B" }, name: "Calibri" };
    noteCell.alignment = { wrapText: true, vertical: "middle" };
    ws.getRow(1).height = 18;
    startRow = 2;
  }

  const headerRowNum = startRow;

  headers.forEach((h, c) => {
    const cell = ws.getCell(headerRowNum, c + 1);
    cell.value = h;
    applyHeaderStyle(cell);
  });
  ws.getRow(headerRowNum).height = 22;

  rows.forEach((dataRow, rowIdx) => {
    const excelRow = headerRowNum + 1 + rowIdx;
    const isAlt = rowIdx % 2 === 1;
    dataRow.forEach((val, c) => {
      const cell = ws.getCell(excelRow, c + 1);
      cell.value = val === null || val === undefined ? "" : val;
      applyDataStyle(cell, val, isAlt);
    });
    ws.getRow(excelRow).height = 18;
  });

  const widths = colWidths(headers, rows);
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  ws.views = [{ state: "frozen", ySplit: headerRowNum, activeCell: `A${headerRowNum + 1}` }];

  const lastCol = colLetter(headers.length);
  ws.autoFilter = {
    from: `A${headerRowNum}`,
    to: `${lastCol}${headerRowNum}`,
  };
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const name = filename.endsWith(".xlsx") ? filename : filename + ".xlsx";
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Public export functions ──────────────────────────────────────────────────

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: any[][];
  note?: string;
}

export function exportXlsx(
  sheets: XlsxSheet[],
  filename: string,
  meta: { title: string; period?: string; keyName?: string } = { title: "AI Proxy Gateway Export" },
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AI Proxy Gateway";
  wb.created = new Date();

  const coverMeta: [string, any][] = [
    ["Exported At", isoNow()],
    ["Sheets", sheets.length],
  ];
  if (meta.keyName) coverMeta.splice(1, 0, ["API Key", meta.keyName]);
  if (meta.period) coverMeta.splice(1, 0, ["Period", meta.period]);

  buildCoverSheet(wb, meta.title, coverMeta);

  for (const s of sheets) {
    buildDataSheet(wb, s.name, s.headers, s.rows, { note: s.note });
  }

  void downloadWorkbook(wb, filename);
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

// ─── Backward compat shim ────────────────────────────────────────────────────

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

// ─── Section builders ─────────────────────────────────────────────────────────

export function buildLogsSection(logs: any[], title = "Request Logs"): XlsxSheet {
  return {
    name: title.slice(0, 31),
    note: "is_counted=Yes means a real user prompt (not IDE retry or sub-agent)",
    headers: [
      "Timestamp", "Model", "Provider", "IDE", "OS", "IP Address",
      "Session ID", "Context Event",
      "Input Tokens", "Billable Input", "Cached Tokens", "Output Tokens", "Total Tokens", "Context Tokens",
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
      Number(l.billablePromptTokens ?? 0),
      Number(l.cachedTokens ?? 0),
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
