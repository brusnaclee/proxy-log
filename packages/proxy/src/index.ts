import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { initializeDatabase } from "./db/index.js";
import { authMiddleware } from "./middleware/session.js";
import proxyRoutes from "./routes/proxy.js";
import authRoutes from "./routes/admin/auth.js";
import settingsRoutes from "./routes/admin/settings.js";
import providersRoutes from "./routes/admin/providers.js";
import keysRoutes from "./routes/admin/keys.js";
import logsRoutes from "./routes/admin/logs.js";
import statsRoutes from "./routes/admin/stats.js";
import internalRoutes from "./routes/admin/internal.js";
import internalAuditRoute from "./routes/internal-audit.js";
import monitorRoutes from "./routes/admin/monitor.js";
import buglogRoutes from "./routes/admin/buglog.js";
import quotaGuardRoutes from "./routes/admin/quota-guard.js";
import trialRoutes from "./routes/admin/trial.js";
import addonsRoutes from "./routes/admin/addons.js";
import recapRoutes from "./routes/admin/recap.js";
import recapWebRoutes from "./routes/recap-web.js";
import portalRoutes from "./routes/portal/index.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { initializeModelCatalogScheduler, initializeMetadataEnrichmentScheduler } from "./utils/model-catalog.js";
import { initializeQuotaGuardScheduler } from "./utils/quota-guard.js";
import { initializeTrialScheduler } from "./utils/trial-scheduler.js";
import { runTranscriptCleanup, run3MonthCleanup } from "./utils/cleanup.js";

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
app.route("/admin", buglogRoutes);
app.route("/admin", quotaGuardRoutes);
app.route("/admin", recapRoutes);
app.route("/admin", trialRoutes);
app.route("/admin", addonsRoutes);

// Service-to-service audit (no admin session required, just internal secret)
app.route("/", internalAuditRoute);

// ─── Proxy Routes (catch-all for /v1/*) ─────────────────────────────────────────
app.route("/v1", proxyRoutes);

// ─── User Portal API ───────────────────────────────────────────────────────────
app.route("/portal/api", portalRoutes);

// ─── Recap: public assets + animated web page (NO auth) ─────────────────────────
app.use("/recap-assets/*", serveStatic({ root: "./public" }));
app.route("/recap", recapWebRoutes);

// ─── Portal SPA: static assets + SPA fallback ───────────────────────────────────
// IMPORTANT: Must come AFTER /v1, /admin, /portal/api, /recap so API routes win.
// /portal/* → JS/CSS/assets from ./public/portal/
// Any other browser path (/, /login, /keys, …) → index.html for client routing.
app.use("/portal/*", serveStatic({
  root: "./public/portal",
  rewriteRequestPath: (path) =>
    path.startsWith("/portal") ? path.slice("/portal".length) || "/index.html" : "/index.html",
}));

const PORTAL_INDEX_PATH = join(process.cwd(), "public", "portal", "index.html");
const API_PREFIXES = ["/v1", "/admin", "/portal", "/recap", "/health", "/internal"];

function isApiOrAssetPath(pathname: string): boolean {
  return API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function servePortalIndex(c: any) {
  try {
    const html = readFileSync(PORTAL_INDEX_PATH, "utf8");
    return c.html(html);
  } catch {
    return c.json({
      error: {
        message: "Portal not built. Run portal build and copy to public/portal.",
        type: "not_found",
      },
    }, 404);
  }
}

// Exact root
app.get("/", (c) => servePortalIndex(c));

// SPA client routes: /login, /keys, /activity, /settings, etc.
// Must NOT catch /v1/*, /admin/*, /portal/*, /recap*, /health
app.get("*", (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (isApiOrAssetPath(pathname)) {
    return next();
  }
  // Only serve SPA for navigation-style GETs (not API-ish Accept headers)
  const accept = c.req.header("Accept") || "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return next();
  }
  return servePortalIndex(c);
});

// ─── 404 Handler ────────────────────────────────────────────────────────────────
app.notFound((c) => {
  const pathname = new URL(c.req.url).pathname;
  // Browser navigations that somehow missed the SPA handler still get index.html
  if (!isApiOrAssetPath(pathname) && c.req.method === "GET") {
    return servePortalIndex(c);
  }
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
  initializeMetadataEnrichmentScheduler();
  initializeQuotaGuardScheduler();
  initializeTrialScheduler();

  // Check every 3 hours if yesterday's data needs cleanup
  // Only clears YESTERDAY's heavy fields, NEVER touches today's data
  // Skips if yesterday already cleaned (stateful)
  setInterval(async () => {
    await runTranscriptCleanup();
  }, 3 * 60 * 60 * 1000); // 3 hours

  // 3-month rolling cleanup - runs daily, deletes months that are 3+ months old
  // Stateful - tracks which months have been cleaned to avoid duplicates
  setInterval(async () => {
    await run3MonthCleanup();
  }, 24 * 60 * 60 * 1000); // 24 hours

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
