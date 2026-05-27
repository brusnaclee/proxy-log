/**
 * Recompute is_counted_request from stored log fields.
 * Usage: npx tsx scripts/backfix-counted-flags.ts [--apply]
 */
import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");
const DB_URL = process.env.DATABASE_URL || "file:./data/gateway.db";
const client = createClient({
  url: DB_URL.startsWith("file:") ? DB_URL : `file:${DB_URL}`,
});

const FIXES: { label: string; countSql: string; updateSql: string }[] = [
  {
    label: "non-2xx",
    countSql: `SELECT COUNT(*) c FROM request_logs WHERE is_counted_request=1 AND (status_code IS NULL OR status_code < 200 OR status_code >= 300)`,
    updateSql: `UPDATE request_logs SET is_counted_request=0 WHERE is_counted_request=1 AND (status_code IS NULL OR status_code < 200 OR status_code >= 300)`,
  },
  {
    label: "non-user role",
    countSql: `SELECT COUNT(*) c FROM request_logs WHERE is_counted_request=1 AND message_role IS NOT NULL AND message_role != 'user'`,
    updateSql: `UPDATE request_logs SET is_counted_request=0 WHERE is_counted_request=1 AND message_role IS NOT NULL AND message_role != 'user'`,
  },
  {
    label: "title-gen",
    countSql: `SELECT COUNT(*) c FROM request_logs WHERE is_counted_request=1 AND (lower(substr(request_preview,1,300)) LIKE '%title generator%' OR lower(substr(request_preview,1,300)) LIKE '%generate a brief title%')`,
    updateSql: `UPDATE request_logs SET is_counted_request=0 WHERE is_counted_request=1 AND (lower(substr(request_preview,1,300)) LIKE '%title generator%' OR lower(substr(request_preview,1,300)) LIKE '%generate a brief title%')`,
  },
  {
    label: "append setup no tools",
    countSql: `SELECT COUNT(*) c FROM request_logs WHERE is_counted_request=1 AND message_role='user' AND status_code BETWEEN 200 AND 299 AND context_event='append' AND COALESCE(tool_count,0)=0 AND COALESCE(has_tool_calls,0)=0 AND COALESCE(completion_tokens,0)=0`,
    updateSql: `UPDATE request_logs SET is_counted_request=0 WHERE is_counted_request=1 AND message_role='user' AND status_code BETWEEN 200 AND 299 AND context_event='append' AND COALESCE(tool_count,0)=0 AND COALESCE(has_tool_calls,0)=0 AND COALESCE(completion_tokens,0)=0`,
  },
];

async function run() {
  console.log("backfix-counted-flags apply=" + APPLY);
  const before = await client.execute("SELECT SUM(CASE WHEN is_counted_request=1 THEN 1 ELSE 0 END) c FROM request_logs");
  console.log("Counted before:", before.rows[0]);

  for (const f of FIXES) {
    const cnt = await client.execute(f.countSql);
    const n = (cnt.rows[0] as any)?.c ?? 0;
    console.log(f.label + ": would fix " + n + " rows");
    if (APPLY && n > 0) {
      await client.execute(f.updateSql);
    }
  }

  if (APPLY) {
    const after = await client.execute("SELECT SUM(CASE WHEN is_counted_request=1 THEN 1 ELSE 0 END) c FROM request_logs");
    console.log("Counted after:", after.rows[0]);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
