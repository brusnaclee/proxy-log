import { Database } from "bun:sqlite";

if (!process.env.DB_PATH) {
  console.log("Setting default DB_PATH to ../proxy/data/gateway.db");
  process.env.DB_PATH = "../proxy/data/gateway.db";
}

const db = new Database(process.env.DB_PATH);

console.log("Starting backfill for is_billable_token...");

let changes = 0;
try {
  // We set is_billable_token = 1 if the request was historically counted,
  // OR if it's a tool follow-up (messageRole = 'tool') with a 2xx status code.
  // We also assume hasToolCalls could play a role but messageRole='tool' is the big one.
  const stmt = db.prepare(`
    UPDATE request_logs
    SET is_billable_token = 1
    WHERE status_code BETWEEN 200 AND 299
      AND (is_counted_request = 1 OR message_role = 'tool' OR has_tool_calls = 1)
  `);
  
  const result = stmt.run();
  changes = result.changes;
  console.log(`Backfill complete. Updated ${changes} rows to be billable.`);
} catch (e) {
  console.error("Failed to run backfill:", e);
}

db.close();