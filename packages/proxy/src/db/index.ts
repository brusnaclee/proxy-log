import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DATABASE_URL || "./data/gateway.db";

// Ensure directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create libsql client (local file-based SQLite)
const client = createClient({
  url: `file:${DB_PATH}`,
});

// Create Drizzle instance with schema
export const db = drizzle(client, { schema });

/**
 * Initialize the database — create tables if they don't exist,
 * and seed a default admin if none is found.
 */
export async function initializeDatabase() {
  // Set pragmas separately (they return rows which executeMultiple doesn't allow)
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");

  // Fix for the table creation bug: if api_keys has password_hash, we need to recreate it.
  const apiKeysPragma = await client.execute(`PRAGMA table_info(api_keys)`);
  const hasPasswordHash = apiKeysPragma.rows.some((row: any) => String(row.name) === "password_hash");
  if (hasPasswordHash) {
    console.log("o. Detected broken api_keys table schema. Recreating and migrating data...");
    await client.execute("PRAGMA foreign_keys = OFF");
    await client.execute("ALTER TABLE api_keys RENAME TO api_keys_broken");
    
    // Create the proper api_keys table
    await client.execute(`
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        discord_user_id TEXT,
        discord_username TEXT,
        provisioned_by TEXT NOT NULL DEFAULT 'dashboard',
        is_active INTEGER NOT NULL DEFAULT 1,
        max_devices INTEGER DEFAULT 0,
        device_policy TEXT NOT NULL DEFAULT 'none',
        ip_policy TEXT NOT NULL DEFAULT 'none',
        ide_policy TEXT NOT NULL DEFAULT 'none',
        monthly_token_limit INTEGER DEFAULT 0,
        rate_limit INTEGER DEFAULT 0,
        rate_limit_window TEXT,
        prompt_limit INTEGER DEFAULT 0,
        prompt_limit_window TEXT,
        per_model_prompt_limit INTEGER DEFAULT 0,
        per_model_prompt_limit_window TEXT,
        pending_notification TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // We copy the data we can (if any exists).
    // The broken table had: id, password_hash, upstream_endpoint, upstream_api_key, created_at, updated_at
    // But none of the valid columns. So if there's data, we can't really copy it cleanly because name, key etc are NOT NULL.
    // However, since it was broken, it's very likely empty. We will just drop the broken table.
    await client.execute("DROP TABLE api_keys_broken");
    await client.execute("PRAGMA foreign_keys = ON");
    console.log("o. Fixed api_keys table schema.");
  }

  // Create all tables directly using SQL (auto-migration)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS admin_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      password_hash TEXT NOT NULL,
      upstream_endpoint TEXT NOT NULL DEFAULT 'https://api.openai.com',
      upstream_api_key TEXT NOT NULL DEFAULT '',
      global_max_devices INTEGER DEFAULT 0,
      realtime_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      discord_user_id TEXT,
      discord_username TEXT,
      provisioned_by TEXT NOT NULL DEFAULT 'dashboard',
      is_active INTEGER NOT NULL DEFAULT 1,
      max_devices INTEGER DEFAULT 0,
      device_policy TEXT NOT NULL DEFAULT 'none',
      ip_policy TEXT NOT NULL DEFAULT 'none',
      ide_policy TEXT NOT NULL DEFAULT 'none',
      monthly_token_limit INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS allowed_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      fingerprint TEXT,
      ip_address TEXT,
      label TEXT DEFAULT '',
      list_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS allowed_ides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      ide_name TEXT NOT NULL,
      list_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_allowed_ides_api_key_ide ON allowed_ides(api_key_id, ide_name);

    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER,
      api_key_name TEXT,
      user_agent_raw TEXT,
      os_detected TEXT,
      client_name TEXT,
      ip_address TEXT,
      device_fingerprint TEXT,
      ide_detected TEXT,
      provider TEXT,
      endpoint_path TEXT,
      session_id TEXT,
      model TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      context_fingerprint TEXT,
      context_tokens_before INTEGER DEFAULT 0,
      context_delta_tokens INTEGER DEFAULT 0,
      context_event TEXT,
      tools_used TEXT,
      tool_count INTEGER DEFAULT 0,
      has_tool_calls INTEGER DEFAULT 0,
      request_preview TEXT,
      response_preview TEXT,
      transcript_snapshot TEXT,
      estimated_context_length INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      status_code INTEGER DEFAULT 0,
      error_message TEXT,
      estimated_cost INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON request_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_api_key_id ON request_logs(api_key_id);
    CREATE INDEX IF NOT EXISTS idx_logs_device_fingerprint ON request_logs(device_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_logs_ip_address ON request_logs(ip_address);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      api_key_id INTEGER,
      api_key_name TEXT,
      ip_address TEXT,
      device_fingerprint TEXT,
      ide_detected TEXT,
      provider TEXT,
      model TEXT,
      context_fingerprint TEXT,
      last_context_tokens INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      compact_count INTEGER NOT NULL DEFAULT 0,
      switch_count INTEGER NOT NULL DEFAULT 0,
      last_request_preview TEXT,
      estimated_cost INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_api_key_id ON chat_sessions(api_key_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_device_fingerprint ON chat_sessions(device_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_at ON chat_sessions(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_context_fingerprint ON chat_sessions(context_fingerprint);

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      ip_address TEXT,
      user_agent_raw TEXT,
      os_detected TEXT,
      device_name TEXT,
      ide_detected TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      request_count INTEGER NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_devices_api_key_fingerprint ON devices(api_key_id, fingerprint);

    CREATE TABLE IF NOT EXISTS model_monitor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      provider TEXT,
      is_online INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      http_status INTEGER DEFAULT 0,
      error_message TEXT,
      base_url TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_model_id ON model_monitor(model_id);
    CREATE INDEX IF NOT EXISTS idx_monitor_checked_at ON model_monitor(checked_at);
  `);

  // Backward-compatible column migration for existing databases
  await ensureColumnExists("admin_config", "global_max_devices", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "realtime_enabled", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists("admin_config", "global_rate_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "global_rate_limit_window", "TEXT DEFAULT '1h'");

  // Fix api_keys columns that might be missing due to the previous schema bug
  await ensureColumnExists("api_keys", "name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists("api_keys", "key", "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists("api_keys", "key_prefix", "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists("api_keys", "key_hash", "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists("api_keys", "discord_user_id", "TEXT");
  await ensureColumnExists("api_keys", "discord_username", "TEXT");
  await ensureColumnExists("api_keys", "provisioned_by", "TEXT NOT NULL DEFAULT 'dashboard'");
  await ensureColumnExists("api_keys", "is_active", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumnExists("api_keys", "max_devices", "INTEGER DEFAULT 0");
  await ensureColumnExists("api_keys", "device_policy", "TEXT NOT NULL DEFAULT 'none'");
  await ensureColumnExists("api_keys", "ip_policy", "TEXT NOT NULL DEFAULT 'none'");
  await ensureColumnExists("api_keys", "ide_policy", "TEXT NOT NULL DEFAULT 'none'");
  await ensureColumnExists("api_keys", "monthly_token_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("api_keys", "rate_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("api_keys", "rate_limit_window", "TEXT");

  await ensureColumnExists("request_logs", "provider", "TEXT");
  await ensureColumnExists("request_logs", "endpoint_path", "TEXT");
  await ensureColumnExists("request_logs", "session_id", "TEXT");
  await ensureColumnExists("request_logs", "user_agent_raw", "TEXT");
  await ensureColumnExists("request_logs", "os_detected", "TEXT");
  await ensureColumnExists("request_logs", "client_name", "TEXT");
  await ensureColumnExists("request_logs", "context_fingerprint", "TEXT");
  await ensureColumnExists("request_logs", "context_tokens_before", "INTEGER DEFAULT 0");
  await ensureColumnExists("request_logs", "context_delta_tokens", "INTEGER DEFAULT 0");
  await ensureColumnExists("request_logs", "context_event", "TEXT");
  await ensureColumnExists("request_logs", "tools_used", "TEXT");
  await ensureColumnExists("request_logs", "tool_count", "INTEGER DEFAULT 0");
  await ensureColumnExists("request_logs", "has_tool_calls", "INTEGER DEFAULT 0");
  await ensureColumnExists("request_logs", "request_preview", "TEXT");
  await ensureColumnExists("request_logs", "response_preview", "TEXT");
  await ensureColumnExists("request_logs", "transcript_snapshot", "TEXT");
  await ensureColumnExists("request_logs", "estimated_cost", "INTEGER DEFAULT 0");
  await ensureColumnExists("chat_sessions", "session_id", "TEXT");
  await ensureColumnExists("chat_sessions", "api_key_id", "INTEGER");
  await ensureColumnExists("chat_sessions", "api_key_name", "TEXT");
  await ensureColumnExists("chat_sessions", "ip_address", "TEXT");
  await ensureColumnExists("chat_sessions", "device_fingerprint", "TEXT");
  await ensureColumnExists("chat_sessions", "ide_detected", "TEXT");
  await ensureColumnExists("chat_sessions", "provider", "TEXT");
  await ensureColumnExists("chat_sessions", "model", "TEXT");
  await ensureColumnExists("chat_sessions", "context_fingerprint", "TEXT");
  await ensureColumnExists("chat_sessions", "last_context_tokens", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists("chat_sessions", "request_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists("chat_sessions", "total_tokens", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists("chat_sessions", "compact_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists("chat_sessions", "switch_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists("chat_sessions", "last_request_preview", "TEXT");
  await ensureColumnExists("chat_sessions", "estimated_cost", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists("chat_sessions", "first_seen_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
  await ensureColumnExists("chat_sessions", "last_seen_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
  await ensureColumnExists("devices", "os_detected", "TEXT");
  await ensureColumnExists("devices", "device_name", "TEXT");

  await ensureColumnExists("admin_config", "discord_bot_token", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "agverif_channel_id", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "tokito_channel_id", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "required_role_id", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "owner_groupy_role_id", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "verified_role_id", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "gemini_api_key", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "verif_auto_enabled", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "tokito_api_key", "TEXT DEFAULT ''");
  await ensureColumnExists("admin_config", "global_prompt_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "global_prompt_limit_window", "TEXT DEFAULT '1d'");
  await ensureColumnExists("api_keys", "prompt_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("api_keys", "prompt_limit_window", "TEXT");
  await ensureColumnExists("chat_sessions", "prompt_count", "INTEGER NOT NULL DEFAULT 0");
  
  // New columns for improved prompt counting
  await ensureColumnExists("chat_sessions", "last_user_message_hash", "TEXT");
  await ensureColumnExists("chat_sessions", "last_message_role", "TEXT");
  await ensureColumnExists("chat_sessions", "last_tool_calls_active", "INTEGER DEFAULT 0");
  await ensureColumnExists("request_logs", "message_role", "TEXT");
  await ensureColumnExists("request_logs", "user_message_hash", "TEXT");
  await ensureColumnExists("request_logs", "actual_tool_calls_in_response", "INTEGER DEFAULT 0");
  await ensureColumnExists("request_logs", "is_counted_request", "INTEGER DEFAULT 1");

  // Human-readable session name derived from first user message
  await ensureColumnExists("chat_sessions", "session_name", "TEXT DEFAULT ''");

  // Per-model prompt limit system
  await ensureColumnExists("admin_config", "global_per_model_prompt_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "global_per_model_prompt_limit_window", "TEXT DEFAULT '1d'");
  await ensureColumnExists("admin_config", "global_daily_token_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "global_monthly_token_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "global_daily_input_token_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("admin_config", "global_daily_output_token_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("api_keys", "per_model_prompt_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("api_keys", "per_model_prompt_limit_window", "TEXT");
  await ensureColumnExists("api_keys", "pending_notification", "TEXT");
  await ensureColumnExists("api_keys", "daily_input_token_limit", "INTEGER DEFAULT 0");
  await ensureColumnExists("api_keys", "daily_output_token_limit", "INTEGER DEFAULT 0");

  // model_limits table for per-model overrides
  await client.execute(`
    CREATE TABLE IF NOT EXISTS model_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_id INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      prompt_limit INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_model_limits_scope_model ON model_limits(scope, scope_id, model)");


  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_id_unique ON chat_sessions(session_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_logs_session_id ON request_logs(session_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_sessions_api_key_id ON chat_sessions(api_key_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_sessions_device_fingerprint ON chat_sessions(device_fingerprint)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_at ON chat_sessions(last_seen_at)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_sessions_context_fingerprint ON chat_sessions(context_fingerprint)");

  const envUpstreamEndpoint = (process.env.UPSTREAM_ENDPOINT || "").trim().replace(/\/$/, "");
  const envUpstreamApiKey = (process.env.UPSTREAM_API_KEY || "").trim();

  // Seed default admin if none exists
  const existingAdmin = await db.select().from(schema.adminConfig).get();
  if (!existingAdmin) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin";
    // Use argon2 for password hashing
    const { hash } = await import("@node-rs/argon2");
    const passwordHash = await hash(defaultPassword);

    await db.insert(schema.adminConfig).values({
      passwordHash,
      upstreamEndpoint: envUpstreamEndpoint || "https://api.openai.com",
      upstreamApiKey: envUpstreamApiKey || "",
    }).run();

    console.log(`✅ Default admin created with password: "${defaultPassword}"`);
    console.log("⚠️  Please change the default password via the dashboard!");
  } else {
    // Optional env bootstrap for existing DB (only fill if currently empty/default)
    const updates: Record<string, string> = {};
    if (envUpstreamApiKey && !existingAdmin.upstreamApiKey) {
      updates.upstreamApiKey = envUpstreamApiKey;
    }
    if (
      envUpstreamEndpoint &&
      (!existingAdmin.upstreamEndpoint || existingAdmin.upstreamEndpoint === "https://api.openai.com")
    ) {
      updates.upstreamEndpoint = envUpstreamEndpoint;
    }
    if (Object.keys(updates).length > 0) {
      await db.update(schema.adminConfig)
        .set({
          ...updates,
          updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
        })
        .where(eq(schema.adminConfig.id, existingAdmin.id))
        .run();
      console.log("✅ Applied UPSTREAM_* env bootstrap into admin_config");
    }
    
    // Also bootstrap bot settings if empty
    const envBotToken = process.env.BOT_TOKEN || "";
    const envAgVerifChannelId = process.env.AGVERIF_CHANNEL_ID || "";
    const envTokitoChannelId = process.env.TOKITO_CHANNEL_ID || "1470313934752972993";
    const envRequiredRole = process.env.REQUIRED_ROLE_ID || "";
    const envOwnerRole = process.env.OWNER_GROUPY_ROLE_ID || "";
    const envVerifiedRole = process.env.VERIFIED_ROLE_ID || "";
    const envGemini = process.env.GOOGLE_API_KEY || "";
    const envVerifAuto = String(process.env.VERIF_AUTO || "false").toLowerCase() === "true";
    const envTokitoKey = process.env.TOKITO_API_KEY || "";
    
    // We update them even if they exist if the user has hardcoded them in .env so .env takes precedence on boot
    const botUpdates: Record<string, any> = {};
    if (envBotToken) botUpdates.discordBotToken = envBotToken;
    if (envAgVerifChannelId) botUpdates.agverifChannelId = envAgVerifChannelId;
    if (envTokitoChannelId) botUpdates.tokitoChannelId = envTokitoChannelId;
    if (envRequiredRole) botUpdates.requiredRoleId = envRequiredRole;
    if (envOwnerRole) botUpdates.ownerGroupyRoleId = envOwnerRole;
    if (envVerifiedRole) botUpdates.verifiedRoleId = envVerifiedRole;
    if (envGemini) botUpdates.geminiApiKey = envGemini;
    botUpdates.verifAutoEnabled = envVerifAuto;
    if (envTokitoKey) botUpdates.tokitoApiKey = envTokitoKey;

    if (Object.keys(botUpdates).length > 0) {
      await db.update(schema.adminConfig)
        .set({
          ...botUpdates,
          updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
        })
        .where(eq(schema.adminConfig.id, existingAdmin.id))
        .run();
      console.log("✅ Synced .env bot variables to admin_config database");
    }
  }

  console.log("✅ Database initialized successfully");
}

export { client };

async function ensureColumnExists(tableName: string, columnName: string, columnSqlType: string) {
  const pragma = await client.execute(`PRAGMA table_info(${tableName})`);
  const hasColumn = pragma.rows.some((row: any) => String(row.name) === columnName);
  if (!hasColumn) {
    await client.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSqlType}`);
  }
}
