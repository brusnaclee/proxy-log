/**
 * Audit request counting patterns per IDE (today WIB).
 * Usage: DATABASE_URL=/path/to/gateway.db npx tsx scripts/audit-counting-by-ide.ts
 */
import { createClient } from "@libsql/client";

const DB_URL = process.env.DATABASE_URL || "file:./data/gateway.db";
const client = createClient({
  url: DB_URL.startsWith("file:") ? DB_URL : `file:${DB_URL}`,
});

function wibTodayStart(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset).toISOString().replace("T", " ").substring(0, 19);
}

async function run() {
  const today = wibTodayStart();
  console.log("=== Audit counting by IDE (since", today, "WIB) ===\n");

  const byIde = await client.execute({
    sql: `SELECT ide_detected, message_role, status_code,
            SUM(CASE WHEN is_counted_request=1 THEN 1 ELSE 0 END) counted,
            COUNT(*) total
          FROM request_logs WHERE created_at >= ?
          GROUP BY ide_detected, message_role, status_code
          ORDER BY total DESC LIMIT 40`,
    args: [today],
  });
  console.log("--- By IDE / role / status ---");
  console.table(byIde.rows);

  const suspicious = await client.execute({
    sql: `SELECT id, api_key_name, ide_detected, message_role, status_code,
            context_event, tool_count, is_counted_request,
            substr(request_preview,1,60) preview
          FROM request_logs
          WHERE is_counted_request=1
            AND (message_role != 'user' OR status_code NOT BETWEEN 200 AND 299)
          ORDER BY id DESC LIMIT 20`,
  });
  console.log("\n--- Suspicious counted rows ---");
  console.table(suspicious.rows);

  const perUser = await client.execute({
    sql: `SELECT api_key_name,
            SUM(CASE WHEN is_counted_request=1 THEN 1 ELSE 0 END) counted_reqs,
            COUNT(*) all_reqs,
            SUM(CASE WHEN is_counted_request=1 AND status_code BETWEEN 200 AND 299 THEN prompt_tokens ELSE 0 END) inp,
            SUM(CASE WHEN is_counted_request=1 AND status_code BETWEEN 200 AND 299 THEN completion_tokens ELSE 0 END) out
          FROM request_logs WHERE created_at >= ?
          GROUP BY api_key_name ORDER BY counted_reqs DESC LIMIT 15`,
    args: [today],
  });
  console.log("\n--- Per user today ---");
  console.table(perUser.rows);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
