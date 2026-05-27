import { createClient } from "@libsql/client";

async function fix() {
  const db = createClient({ url: "file:./data/gateway.db" });

  console.log("Checking api_keys schema...");
  const pragma = await db.execute("PRAGMA table_info(api_keys)");
  const hasPass = pragma.rows.some((r: any) => r.name === "password_hash");

  if (hasPass) {
    const countRes = await db.execute("SELECT COUNT(*) as cnt FROM api_keys");
    const rowCount = Number((countRes.rows[0] as any)?.cnt || 0);
    const backupName = `api_keys_broken_${Date.now()}`;

    console.log(`Found broken api_keys table (${rowCount} rows). Backing up as ${backupName}...`);
    await db.execute("PRAGMA foreign_keys = OFF;");
    await db.execute(`ALTER TABLE api_keys RENAME TO ${backupName};`);

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

    if (rowCount > 0) {
      console.warn(`WARNING: ${rowCount} rows in ${backupName} — restore manually if needed. Table NOT dropped.`);
    } else {
      await db.execute(`DROP TABLE ${backupName};`);
    }

    await db.execute("PRAGMA foreign_keys = ON;");
    console.log("api_keys table recreated successfully!");
  } else {
    console.log("api_keys table is already fine.");
  }
}
fix().catch(console.error);
