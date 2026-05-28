import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { initializeDatabase, db } from "./db/index.js";
import { sql } from "drizzle-orm";
import { requestLogs, chatSessions } from "./db/schema.js";
import { authMiddleware } from "./middleware/session.js";
import proxyRoutes from "./routes/proxy.js";
import authRoutes from "./routes/admin/auth.js";
import settingsRoutes from "./routes/admin/settings.js";
import providersRoutes from "./routes/admin/providers.js";
import keysRoutes from "./routes/admin/keys.js";
import logsRoutes from "./routes/admin/logs.js";
import statsRoutes from "./routes/admin/stats.js";
import internalRoutes from "./routes/admin/internal.js";
import monitorRoutes from "./routes/admin/monitor.js";
import { initializeModelCatalogScheduler } from "./utils/model-catalog.js";

// Load environment from root .env regardless of current working directory.
const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), "../../.env"),
];
for (const p of envCandidates) {
  if (existsSync(p)) {
    loadEnv({ path: p, override: false });
    break;
  }
}

// ─── Initialize App ────────────────────────────────────────────────────────────
const app = new Hono();

// ─── Global Middleware ──────────────────────────────────────────────────────────
app.use("*", logger());

// CORS — allow dashboard origin
app.use("*", cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
  ],
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowHeaders: ["Content-Type", "Authorization", "Cookie"],
  exposeHeaders: ["Set-Cookie"],
}));

// ─── Health Check ───────────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// ─── Admin Routes (protected by auth middleware) ────────────────────────────────
app.use("/admin/*", authMiddleware);
app.route("/admin", authRoutes);
app.route("/admin", settingsRoutes);
app.route("/admin", providersRoutes);
app.route("/admin", keysRoutes);
app.route("/admin", logsRoutes);
app.route("/admin", statsRoutes);
app.route("/admin", internalRoutes);
app.route("/admin", monitorRoutes);

// ─── Proxy Routes (catch-all for /v1/*) ─────────────────────────────────────────
app.route("/v1", proxyRoutes);

// ─── 404 Handler ────────────────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json({
    error: {
      message: "Not found. Use /v1/* for API proxy or /admin/* for dashboard API.",
      type: "not_found",
    }
  }, 404);
});

// ─── Error Handler ──────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({
    error: {
      message: "Internal server error",
      type: "server_error",
    }
  }, 500);
});

// ─── Start Server ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3000");

async function main() {
  // Initialize database (create tables, seed admin)
  await initializeDatabase();
  await initializeModelCatalogScheduler();

  // Clean heavy TEXT fields every 2 hours (runs in background)
  // Clears transcript_snapshot, request_preview, response_preview, error_message
  // from rows older than 24 hours while preserving all metadata (tokens, cost, status)
  setInterval(async () => {
    try {
      const res = await db.update(requestLogs)
        .set({
          transcriptSnapshot: "",
          requestPreview: "",
          responsePreview: "",
          errorMessage: ""
        })
        .where(sql`
          created_at < datetime('now', '-1 day')
          AND (
            transcript_snapshot != ''
            OR request_preview != ''
            OR response_preview != ''
            OR error_message IS NOT NULL AND error_message != ''
          )
        `)
        .run();

      await db.update(chatSessions)
        .set({ lastRequestPreview: "" })
        .where(sql`last_seen_at < datetime('now', '-1 day') AND last_request_preview != ''`)
        .run();

      console.log(`[proxy] Automatic cleanup completed. Cleared ${res.rowsAffected} rows.`);
    } catch (err) {
      console.error("[proxy] Automatic cleanup failed:", err);
    }
  }, 2 * 60 * 60 * 1000); // 2 hours

  // Check daily and delete data older than 3 months on the 1st of each month
  // Using daily check to avoid setInterval overflow (>24.8 days)
  let lastCleanupMonth = -1;
  setInterval(async () => {
    try {
      const now = new Date();
      // Only run on the 1st day of month, and only once per month
      if (now.getDate() === 1 && lastCleanupMonth !== now.getMonth()) {
        lastCleanupMonth = now.getMonth();

        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 3);
        const cutoffStr = cutoff.toISOString().replace("T", " ").substring(0, 19);

        const deletedLogs = await db.delete(requestLogs)
          .where(sql`created_at < ${cutoffStr}`)
          .run();

        const deletedSessions = await db.delete(chatSessions)
          .where(sql`last_seen_at < ${cutoffStr}`)
          .run();

        await db.run(sql`VACUUM`);

        console.log(`[proxy] Monthly 3-month cleanup completed. Deleted ${deletedLogs.rowsAffected} logs, ${deletedSessions.rowsAffected} sessions.`);
      }
    } catch (err) {
      console.error("[proxy] 3-month cleanup failed:", err);
    }
  }, 24 * 60 * 60 * 1000); // Check daily (24 hours)

  serve({
    fetch: app.fetch,
    port: PORT,
  }, (info) => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║          AI API Proxy Gateway — Running                  ║
╠══════════════════════════════════════════════════════════╣
║  Proxy endpoint:  http://localhost:${PORT}/v1/*             ║
║  Admin API:       http://localhost:${PORT}/admin/*           ║
║  Health check:    http://localhost:${PORT}/health            ║
╚══════════════════════════════════════════════════════════╝
    `);
  });
}

main().catch(console.error);

export default app;
