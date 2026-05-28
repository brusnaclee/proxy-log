import { Hono } from "hono";
import { db } from "../../db/index.js";
import { chatSessions, requestLogs, apiKeys, devices, allowedDevices, allowedIdes, modelMonitor } from "../../db/schema.js";
import { eq, sql, and, desc } from "drizzle-orm";
import { logEmitter } from "../../utils/event-emitter.js";
import { parseToolJson } from "../../utils/telemetry.js";
import { forceTranscriptCleanup, forceCleanMonth, getCleanupStatus } from "../../utils/cleanup.js";

const logs = new Hono();

function parseTranscriptSnapshot(value: string | null | undefined): Array<{ role: string; content: string }> {
  if (!value) return [];
  return String(value)
    .split("\n")
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx <= 0) return null;
      const role = line.slice(0, idx).trim();
      const content = line.slice(idx + 1).trim();
      if (!role || !content) return null;
      return { role, content };
    })
    .filter(Boolean) as Array<{ role: string; content: string }>;
}

function getTurnKey(row: any): string {
  const transcript = parseTranscriptSnapshot(row.transcriptSnapshot);
  const latestUser = [...transcript]
    .reverse()
    .find((entry) => String(entry.role).toLowerCase() === "user")?.content || "";
  const preview = String(row.requestPreview || "").trim();
  const normalizedPrompt = (latestUser || preview).replace(/\s+/g, " ").toLowerCase().slice(0, 2000);
  const model = String(row.model || "unknown").toLowerCase();
  const tools = parseToolJson(row.toolsUsed).join("|").toLowerCase();
  return `${model}::${normalizedPrompt}::${tools}`;
}

function mapTimelineRow(row: any) {
  return {
    ...row,
    toolsUsed: parseToolJson(row.toolsUsed),
    transcript: parseTranscriptSnapshot(row.transcriptSnapshot),
  };
}

function collapseTimelineRows(rows: any[]) {
  const collapsed: any[] = [];

  for (const row of rows) {
    const turnKey = getTurnKey(row);
    const mapped = mapTimelineRow(row);
    const previous = collapsed[collapsed.length - 1];

    if (previous && previous.turnKey === turnKey) {
      previous.attemptCount += 1;
      previous.lastSeenAt = mapped.createdAt;
      previous.statusTrail.push(mapped.statusCode || 0);
      previous.latencyTrail.push(mapped.latencyMs || 0);
      if (mapped.errorMessage) {
        previous.errorMessages.push(mapped.errorMessage);
      }

      const mergedTools = new Set<string>([...previous.toolsUsed, ...mapped.toolsUsed]);
      previous.toolsUsed = Array.from(mergedTools);

      const previousOk = (previous.statusCode || 0) < 400;
      const mappedOk = (mapped.statusCode || 0) < 400;
      if (mappedOk || !previousOk) {
        previous.statusCode = mapped.statusCode;
        previous.responsePreview = mapped.responsePreview;
        previous.errorMessage = mapped.errorMessage;
        previous.createdAt = mapped.createdAt;
      }

      if ((mapped.transcript || []).length >= (previous.transcript || []).length) {
        previous.transcript = mapped.transcript;
      }

      continue;
    }

    collapsed.push({
      ...mapped,
      turnKey,
      firstSeenAt: mapped.createdAt,
      lastSeenAt: mapped.createdAt,
      attemptCount: 1,
      statusTrail: [mapped.statusCode || 0],
      latencyTrail: [mapped.latencyMs || 0],
      errorMessages: mapped.errorMessage ? [mapped.errorMessage] : [],
    });
  }

  return collapsed;
}

logs.get("/logs", async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "500"), 500);
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  const apiKeyId = c.req.query("api_key_id");
  const model = c.req.query("model");
  const ide = c.req.query("ide");
  const provider = c.req.query("provider");
  const ip = c.req.query("ip");
  const status = c.req.query("status");
  const sessionId = c.req.query("session_id");
  const contextEvent = c.req.query("context_event");
  const from = c.req.query("from");
  const to = c.req.query("to");

  if (apiKeyId) conditions.push(eq(requestLogs.apiKeyId, parseInt(apiKeyId)));
  if (model) conditions.push(eq(requestLogs.model, model));
  if (ide) conditions.push(eq(requestLogs.ideDetected, ide));
  if (provider) conditions.push(eq(requestLogs.provider, provider));
  if (ip) conditions.push(eq(requestLogs.ipAddress, ip));
  if (status) conditions.push(eq(requestLogs.statusCode, parseInt(status)));
  if (sessionId) conditions.push(eq(requestLogs.sessionId, sessionId));
  if (contextEvent) conditions.push(eq(requestLogs.contextEvent, contextEvent));
  if (from) conditions.push(sql`created_at >= ${from}`);
  if (to) conditions.push(sql`created_at <= ${to}`);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(requestLogs).where(whereClause)
    .orderBy(desc(requestLogs.createdAt)).limit(limit).offset(offset).all();

  const totalResult = await db.select({ count: sql<number>`count(*)` }).from(requestLogs).where(whereClause).get();
  const total = Math.min(totalResult?.count || 0, 500);

  const mappedRows = rows.map((row: any) => mapTimelineRow(row));

  return c.json({
    data: mappedRows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  });
});

logs.get("/logs/sessions", async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 100);
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  const apiKeyId = c.req.query("api_key_id");
  const model = c.req.query("model");
  const ide = c.req.query("ide");
  const provider = c.req.query("provider");
  const sessionId = c.req.query("session_id");

  if (apiKeyId) conditions.push(eq(chatSessions.apiKeyId, parseInt(apiKeyId)));
  if (model) conditions.push(eq(chatSessions.model, model));
  if (ide) conditions.push(eq(chatSessions.ideDetected, ide));
  if (provider) conditions.push(eq(chatSessions.provider, provider));
  if (sessionId) conditions.push(eq(chatSessions.sessionId, sessionId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(chatSessions).where(whereClause)
    .orderBy(desc(chatSessions.lastSeenAt)).limit(limit).offset(offset).all();

  const totalResult = await db.select({ count: sql<number>`count(*)` }).from(chatSessions).where(whereClause).get();
  const total = Math.min(totalResult?.count || 0, 100);

  return c.json({ data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

logs.get("/logs/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const mode = (c.req.query("mode") || "collapsed").toLowerCase();
  const session = await db.select().from(chatSessions).where(eq(chatSessions.sessionId, sessionId)).get();
  if (!session) return c.json({ error: "Session not found" }, 404);

  const timeline = await db.select().from(requestLogs)
    .where(eq(requestLogs.sessionId, sessionId))
    .orderBy(requestLogs.createdAt)
    .all();

  const mappedTimeline = timeline.map((row: any) => mapTimelineRow(row));
  const collapsedTimeline = collapseTimelineRows(timeline);

  return c.json({
    session,
    timeline: mode === "raw" ? mappedTimeline : collapsedTimeline,
    rawTimelineCount: mappedTimeline.length,
    turnCount: collapsedTimeline.length,
  });
});

logs.get("/logs/stream", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { clearInterval(keepalive); }
      }, 30000);

      const unsubscribe = logEmitter.on((logEntry) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(logEntry)}\n\n`)); }
        catch { unsubscribe(); clearInterval(keepalive); }
      });

      c.req.raw.signal?.addEventListener("abort", () => {
        unsubscribe(); clearInterval(keepalive);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" },
  });
});

logs.delete("/logs", async (c) => {
  const days = parseInt(c.req.query("days") || "90");
  
  let result;
  if (days <= 0) {
    // days=0 means delete ALL logs
    result = await db.delete(requestLogs).run();
    await db.delete(chatSessions).run();
    return c.json({ success: true, message: "Deleted all logs and sessions", deletedCount: result.rowsAffected });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  // Format as SQLite-compatible string (matches how timestamps are stored in DB)
  const cutoffStr = cutoff.toISOString().replace("T", " ").substring(0, 19);
  result = await db.delete(requestLogs).where(sql`created_at < ${cutoffStr}`).run();

  // Also delete chat sessions that haven't been seen since cutoff
  await db.delete(chatSessions).where(sql`last_seen_at < ${cutoffStr}`).run();

  // Clear transcript/preview data from remaining older logs to save space
  await db.update(requestLogs)
    .set({ transcriptSnapshot: "", requestPreview: "", responsePreview: "" })
    .where(sql`created_at < datetime('now', '-1 day')`)
    .run();

  return c.json({ success: true, message: `Deleted logs older than ${days} days`, deletedCount: result.rowsAffected });
});

// Manual transcript cleanup endpoint (force run)
logs.post("/logs/cleanup-transcripts", async (c) => {
  try {
    const result = await forceTranscriptCleanup();
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: "Failed to cleanup transcripts", details: error.message }, 500);
  }
});

// Manual 3-month cleanup for a specific month
logs.post("/logs/clean-month/:yearMonth", async (c) => {
  try {
    const yearMonth = c.req.param("yearMonth");
    // Validate format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return c.json({ error: "Invalid format. Use YYYY-MM (e.g., 2026-01)" }, 400);
    }
    const result = await forceCleanMonth(yearMonth);
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: "Failed to clean month", details: error.message }, 500);
  }
});

// Get cleanup status
logs.get("/logs/cleanup-status", async (c) => {
  try {
    const status = await getCleanupStatus();
    return c.json({ success: true, ...status });
  } catch (error: any) {
    return c.json({ error: "Failed to get cleanup status", details: error.message }, 500);
  }
});

logs.post("/logs/clear-all", async (c) => {
  try {
    await db.delete(requestLogs).run();
    await db.delete(chatSessions).run();
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: "Failed to clear all logs", details: error.message }, 500);
  }
});

// ─── Nuclear Reset: delete everything including API keys & devices ────────────
logs.post("/logs/nuke-all", async (c) => {
  try {
    await db.delete(requestLogs).run();
    await db.delete(chatSessions).run();
    await db.delete(allowedIdes).run();
    await db.delete(allowedDevices).run();
    await db.delete(devices).run();
    await db.delete(apiKeys).run();
    await db.delete(modelMonitor).run();
    return c.json({ success: true, message: "All data wiped: logs, sessions, API keys, devices, and model monitor." });
  } catch (error: any) {
    return c.json({ error: "Failed to nuke all data", details: error.message }, 500);
  }
});

export default logs;
