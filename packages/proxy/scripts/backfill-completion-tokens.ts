/**
 * Backfill completion_tokens for historical request_logs rows.
 *
 * Estimates output tokens from response_preview (and falls back to
 * transcript_snapshot when response_preview is empty) for rows that were
 * logged before the token-extractor improvements.
 *
 * Usage:
 *   tsx packages/proxy/scripts/backfill-completion-tokens.ts          # dry-run
 *   tsx packages/proxy/scripts/backfill-completion-tokens.ts --apply  # write changes
 */

import { createClient } from "@libsql/client";
import { estimateTokens } from "../src/utils/detect-ide.js";
import { calculateEstimatedCost } from "../src/utils/cost-calculator.js";

const APPLY = process.argv.includes("--apply");
const BATCH = 500;
const DB_URL = process.env.DATABASE_URL || "file:./data/gateway.db";

const client = createClient({
  url: DB_URL.startsWith("file:") ? DB_URL : "file:" + DB_URL,
});

function estimateFromTranscript(snapshot: string | null): string {
  if (!snapshot) return "";
  // transcript_snapshot stores the request transcript (mostly user side),
  // but for old rows the assistant turn may not exist. Use the last
  // ~600 chars as a rough proxy when nothing better is available.
  return snapshot.slice(-600);
}

function deriveCompletionText(row: {
  response_preview: string | null;
  transcript_snapshot: string | null;
  tools_used: string | null;
}): string {
  if (row.response_preview && row.response_preview.trim().length > 0) {
    return row.response_preview;
  }
  const fromTranscript = estimateFromTranscript(row.transcript_snapshot);
  if (fromTranscript) return fromTranscript;
  if (row.tools_used && row.tools_used !== "[]") {
    return row.tools_used;
  }
  return "";
}

async function run() {
  console.log("Backfill completion_tokens (apply=" + APPLY + ", db=" + DB_URL + ")");

  const stats = await client.execute(
    "SELECT COUNT(*) as total, " +
      "SUM(CASE WHEN completion_tokens > 0 THEN 1 ELSE 0 END) as with_completion " +
      "FROM request_logs WHERE is_counted_request = 1 AND status_code BETWEEN 200 AND 299"
  );
  console.log("Counted-success rows:", stats.rows[0]);

  let offset = 0;
  let updated = 0;
  let scanned = 0;

  while (true) {
    const result = await client.execute({
      sql:
        "SELECT id, model, prompt_tokens, completion_tokens, total_tokens, " +
        "estimated_cost, response_preview, transcript_snapshot, tools_used " +
        "FROM request_logs " +
        "WHERE is_counted_request = 1 AND status_code BETWEEN 200 AND 299 " +
        "  AND (completion_tokens IS NULL OR completion_tokens = 0) " +
        "ORDER BY id ASC LIMIT ? OFFSET ?",
      args: [BATCH, offset],
    });
    if (result.rows.length === 0) break;

    for (const r of result.rows as any[]) {
      scanned++;
      const completionText = deriveCompletionText({
        response_preview: r.response_preview,
        transcript_snapshot: r.transcript_snapshot,
        tools_used: r.tools_used,
      });
      if (!completionText) continue;
      const newCompletion = estimateTokens(completionText);
      if (!newCompletion) continue;
      const promptTokens = Number(r.prompt_tokens || 0);
      const newTotal = promptTokens + newCompletion;
      const newCost = calculateEstimatedCost(r.model || "", promptTokens, newCompletion);
      if (APPLY) {
        await client.execute({
          sql:
            "UPDATE request_logs SET completion_tokens = ?, total_tokens = ?, estimated_cost = ? WHERE id = ?",
          args: [newCompletion, newTotal, newCost, r.id],
        });
      }
      updated++;
    }

    console.log("Batch offset=" + offset + " scanned=" + result.rows.length + " updates_running=" + updated);
    if (!APPLY) {
      // In dry-run we still advance offset; but since we are not changing rows
      // the same rows would re-appear. Break after first batch sample.
      if (offset >= BATCH * 4) break;
    }
    offset += BATCH;
  }

  console.log("Done. scanned=" + scanned + " updated=" + updated + " applied=" + APPLY);
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
