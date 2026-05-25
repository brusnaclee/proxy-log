import { client } from "./index.js";

export async function up() {
  const queries = [
    `ALTER TABLE admin_config ADD COLUMN global_rate_limit INTEGER DEFAULT 0`,
    `ALTER TABLE admin_config ADD COLUMN global_rate_limit_window TEXT DEFAULT '1h'`,
    `ALTER TABLE api_keys ADD COLUMN rate_limit INTEGER DEFAULT 0`,
    `ALTER TABLE api_keys ADD COLUMN rate_limit_window TEXT`
  ];

  for (const query of queries) {
    try {
      await client.execute(query);
      console.log(`Executed: ${query}`);
    } catch (e: any) {
      if (!e.message.includes("duplicate column name")) {
        console.error(`Migration error: ${e.message}`);
      } else {
        console.log(`Column already exists, skipped.`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  up().catch(console.error);
}