/**
 * Recompute tokens for counted+success rows from request/response previews.
 * Usage: npx tsx scripts/backfix-tokens-counted-only.ts [--apply]
 */
import { createClient } from "@libsql/client";
import { estimateTokens } from "../src/utils/detect-ide.js";
import { calculateEstimatedCost } from "../src/utils/cost-calculator.js";

const APPLY = process.argv.includes("--apply");
const BATCH = 500;
const DB_URL = process.env.DATABASE_URL || "file:./data/gateway.db";
const client = createClient({
  url: DB_URL.startsWith("file:") ? DB_URL : `file:${DB_URL}`,
});

function promptFromRow(row: any): string {
  return String(row.request_preview || "").trim();
}

function completionFromRow(row: any): string {
  const preview = String(row.response_preview || "").trim();
  if (preview) return preview;
  const snap = String(row.transcript_snapshot || "");
  if (snap) return snap.slice(-600);
  if (row.tools_used && row.tools_used !== "[]") return String(row.tools_used);
  return "";
}

async function run() {
  console.log("backfix-tokens-counted-only apply=" + APPLY);
  let offset = 0;
  let updated = 0;

  while (true) {
    const result = await client.execute({
      sql: `SELECT id, model, request_preview, response_preview, transcript_snapshot, tools_used
            FROM request_logs
            WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299
            ORDER BY id ASC LIMIT ? OFFSET ?`,
      args: [BATCH, offset],
    });
    if (result.rows.length === 0) break;

    for (const r of result.rows as any[]) {
      const promptText = promptFromRow(r);
      const completionText = completionFromRow(r);
      const promptTokens = promptText ? Math.max(estimateTokens(promptText), 1) : 0;
      let completionTokens = completionText ? Math.max(estimateTokens(completionText), 1) : 0;
      if (!promptTokens && !completionTokens) continue;
      const totalTokens = promptTokens + completionTokens;
      const estimatedCost = calculateEstimatedCost(r.model || "", promptTokens, completionTokens);
      if (APPLY) {
        await client.execute({
          sql: `UPDATE request_logs SET prompt_tokens=?, completion_tokens=?, total_tokens=?, estimated_cost=? WHERE id=?`,
          args: [promptTokens, completionTokens, totalTokens, estimatedCost, r.id],
        });
      }
      updated++;
    }
    offset += BATCH;
    console.log("Batch offset=" + offset + " updates=" + updated);
  }
  console.log("Done updated=" + updated);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
