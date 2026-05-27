/**
 * Rebuild chat_sessions stats from request_logs.
 * Usage: npx tsx scripts/rebuild-session-stats.ts [--apply]
 */
import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");
const DB_URL = process.env.DATABASE_URL || "file:./data/gateway.db";
const client = createClient({
  url: DB_URL.startsWith("file:") ? DB_URL : `file:${DB_URL}`,
});

async function run() {
  console.log("rebuild-session-stats apply=" + APPLY);
  if (!APPLY) {
    const sample = await client.execute(`
      SELECT session_id,
        SUM(CASE WHEN is_counted_request=1 AND status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END) prompts,
        SUM(CASE WHEN is_counted_request=1 AND status_code BETWEEN 200 AND 299 THEN total_tokens ELSE 0 END) tokens
      FROM request_logs WHERE session_id IS NOT NULL
      GROUP BY session_id ORDER BY tokens DESC LIMIT 5`);
    console.log("Sample sessions:", sample.rows);
    console.log("Run with --apply to rebuild chat_sessions");
    return;
  }

  await client.execute(`
    UPDATE chat_sessions SET
      request_count = 0,
      prompt_count = 0,
      total_tokens = 0,
      estimated_cost = 0
  `);

  await client.execute(`
    UPDATE chat_sessions SET
      request_count = COALESCE((
        SELECT COUNT(*) FROM request_logs rl
        WHERE rl.session_id = chat_sessions.session_id
          AND rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299
      ), 0),
      prompt_count = COALESCE((
        SELECT COUNT(*) FROM request_logs rl
        WHERE rl.session_id = chat_sessions.session_id
          AND rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299
      ), 0),
      total_tokens = COALESCE((
        SELECT SUM(total_tokens) FROM request_logs rl
        WHERE rl.session_id = chat_sessions.session_id
          AND rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299
      ), 0),
      estimated_cost = COALESCE((
        SELECT SUM(estimated_cost) FROM request_logs rl
        WHERE rl.session_id = chat_sessions.session_id
          AND rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299
      ), 0)
  `);

  console.log("Session stats rebuilt.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
