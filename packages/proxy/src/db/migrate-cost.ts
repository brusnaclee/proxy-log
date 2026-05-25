import { client } from "./index.js";
import { requestLogs, chatSessions } from "./schema.js";

export async function up() {
  const tableInfos = [
    { name: "request_logs", column: "estimated_cost", type: "integer DEFAULT 0" },
    { name: "chat_sessions", column: "estimated_cost", type: "integer NOT NULL DEFAULT 0" }
  ];

  for (const { name, column, type } of tableInfos) {
    try {
      const result = await client.execute({ sql: `PRAGMA table_info(${name})`, args: [] });
      const columns = result.rows.map((row: any) => row.name);
      if (!columns.includes(column)) {
        console.log(`Adding ${column} to ${name}...`);
        await client.execute({ sql: `ALTER TABLE ${name} ADD COLUMN ${column} ${type}`, args: [] });
      } else {
        console.log(`Column ${column} already exists in ${name}.`);
      }
    } catch (e: any) {
      console.error(`Migration error for ${name}.${column}:`, e.message);
    }
  }
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  up().catch(console.error);
}