import { createClient } from "@libsql/client";

async function fix() {
  const db = createClient({ url: "file:./data/gateway.db" });

  console.log("Checking api_keys schema...");
  const pragma = await db.execute("PRAGMA table_info(api_keys)");
  const hasPass = pragma.rows.some(r => r.name === "password_hash");
  
  if (hasPass) {
    console.log("Found broken api_keys table! Fixing...");
    await db.execute("PRAGMA foreign_keys = OFF;");
    await db.execute("ALTER TABLE api_keys RENAME TO api_keys_broken;");
    
    await db.execute(`
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
    
    await db.execute("DROP TABLE api_keys_broken;");
    console.log("api_keys table recreated successfully!");
  } else {
    console.log("api_keys table is already fine.");
  }
}
fix().catch(console.error);