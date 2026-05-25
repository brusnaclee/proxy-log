import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { initializeDatabase } from "./db/index.js";
import { authMiddleware } from "./middleware/session.js";
import proxyRoutes from "./routes/proxy.js";
import authRoutes from "./routes/admin/auth.js";
import settingsRoutes from "./routes/admin/settings.js";
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

  // Clean old transcripts every 12 hours (runs in background)
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${PORT}/admin/logs/cleanup-transcripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      console.log("[proxy] Automatic transcript cleanup completed.");
    } catch (err) {
      console.error("[proxy] Automatic transcript cleanup failed:", err);
    }
  }, 12 * 60 * 60 * 1000);

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
