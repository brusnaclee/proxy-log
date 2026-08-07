/**
 * Transparent Input-toward-limit breakdown from request_logs hops.
 * Same meter as gates / Discord Today / portal: upstream_credits when set,
 * else (prompt+cache)×local input multiplier; hop weights from admin config.
 */

import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  getTokenLimitWeightModeSync,
  getTokenLimitWeightPercentSync,
} from "./counting.js";
import { sqlMultiplierExpr } from "./token-multiplier.js";

export type InputLimitBreakdown = {
  promptCount: number;
  apiCallCount: number;
  followUpCount: number;
  sumInPromptHops: number;
  sumInFollowUps: number;
  avgInPerPrompt: number;
  avgInPerFollowUp: number;
  creditPrompts: number;
  creditFollowUps: number;
  inputTowardLimit: number;
  weightPercent: number;
  weightMode: string;
  peakBillable: number;
  peakCached: number;
  peakFullIn: number;
};

export function emptyInputLimitBreakdown(): InputLimitBreakdown {
  return {
    promptCount: 0,
    apiCallCount: 0,
    followUpCount: 0,
    sumInPromptHops: 0,
    sumInFollowUps: 0,
    avgInPerPrompt: 0,
    avgInPerFollowUp: 0,
    creditPrompts: 0,
    creditFollowUps: 0,
    inputTowardLimit: 0,
    weightPercent: getTokenLimitWeightPercentSync(),
    weightMode: getTokenLimitWeightModeSync(),
    peakBillable: 0,
    peakCached: 0,
    peakFullIn: 0,
  };
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Compute hop-weighted input breakdown for a billable hop WHERE clause
 * (must already include api_key_id / date / status filters).
 */
export async function fetchInputLimitBreakdown(
  whereCondition: SQL,
): Promise<InputLimitBreakdown> {
  const weightPct = getTokenLimitWeightPercentSync();
  const weightMode = getTokenLimitWeightModeSync();
  const restFrac =
    weightMode === "full" ? 1 : weightMode === "flat_all" ? weightPct / 100 : weightPct / 100;
  const min = sql.raw(sqlMultiplierExpr("input", "model"));

  const rows = await db.execute(sql`
    WITH hops AS (
      SELECT
        id,
        model,
        COALESCE(turn_id, 'orphan-' || id::text) AS turn_key,
        COALESCE(prompt_tokens, 0)::float8 AS billable,
        COALESCE(cached_tokens, 0)::float8 AS cached,
        (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS full_in,
        COALESCE(upstream_credits, 0)::float8 AS uc,
        CASE
          WHEN COALESCE(upstream_credits, 0) > 0 THEN GREATEST(0, COALESCE(upstream_credits, 0) - COALESCE(upstream_credits_out, 0))::float8
          ELSE (COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 * ${min}
        END AS meter_in,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(turn_id, 'orphan-' || id::text)
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM request_logs
      WHERE ${whereCondition}
    ),
    hop_agg AS (
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE rn = 1), 0)::int AS prompt_count,
        COALESCE(COUNT(*), 0)::int AS api_call_count,
        COALESCE(SUM(meter_in) FILTER (WHERE rn = 1), 0)::float8 AS sum_in_prompts,
        COALESCE(SUM(meter_in) FILTER (WHERE rn > 1), 0)::float8 AS sum_in_followups
      FROM hops
    ),
    turn_peaks AS (
      SELECT DISTINCT ON (turn_key)
        turn_key,
        full_in AS peak_full,
        billable AS peak_bill,
        cached AS peak_cache,
        meter_in AS peak_meter
      FROM hops
      ORDER BY turn_key, meter_in DESC, id DESC
    ),
    peak_agg AS (
      SELECT
        COALESCE(AVG(peak_full), 0)::float8 AS avg_peak_full,
        COALESCE(AVG(peak_bill), 0)::float8 AS avg_peak_bill,
        COALESCE(AVG(peak_cache), 0)::float8 AS avg_peak_cache,
        COALESCE(SUM(peak_meter), 0)::float8 AS sum_peak_meter
      FROM turn_peaks
    )
    SELECT
      hop_agg.prompt_count,
      hop_agg.api_call_count,
      hop_agg.sum_in_prompts,
      hop_agg.sum_in_followups,
      peak_agg.avg_peak_full,
      peak_agg.avg_peak_bill,
      peak_agg.avg_peak_cache,
      peak_agg.sum_peak_meter
    FROM hop_agg, peak_agg
  `);

  const row = (rows.rows as any[])[0] || {};
  const promptCount = n(row.prompt_count);
  const apiCallCount = n(row.api_call_count);
  const followUpCount = Math.max(0, apiCallCount - promptCount);
  const sumInPromptHops = Math.round(n(row.sum_in_prompts));
  const sumInFollowUps = Math.round(n(row.sum_in_followups));
  const avgInPerPrompt = promptCount > 0 ? Math.round(sumInPromptHops / promptCount) : 0;
  const avgInPerFollowUp = followUpCount > 0 ? Math.round(sumInFollowUps / followUpCount) : 0;

  let creditPrompts: number;
  let creditFollowUps: number;
  if (weightMode === "full") {
    creditPrompts = sumInPromptHops;
    creditFollowUps = sumInFollowUps;
  } else if (weightMode === "peak") {
    // Peak mode: sum of per-turn peak meters (same idea as peakPromptTokensSql)
    creditPrompts = Math.round(n(row.sum_peak_meter));
    creditFollowUps = 0;
  } else {
    creditPrompts = sumInPromptHops;
    creditFollowUps = Math.round(sumInFollowUps * restFrac);
  }

  return {
    promptCount,
    apiCallCount,
    followUpCount,
    sumInPromptHops,
    sumInFollowUps,
    avgInPerPrompt,
    avgInPerFollowUp,
    creditPrompts,
    creditFollowUps,
    inputTowardLimit: creditPrompts + creditFollowUps,
    weightPercent: weightPct,
    weightMode,
    peakBillable: Math.round(n(row.avg_peak_bill)),
    peakCached: Math.round(n(row.avg_peak_cache)),
    peakFullIn: Math.round(n(row.avg_peak_full)),
  };
}

export type UsageLang = "en" | "id";

function fmtTok(n: number, lang: UsageLang): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "");
    return lang === "id" ? `${v.replace(".", ",")} juta` : `${v}M`;
  }
  if (abs >= 1_000) {
    const v = (n / 1_000).toFixed(1).replace(/\.0$/, "");
    return lang === "id" ? `${v.replace(".", ",")} ribu` : `${v}K`;
  }
  return String(Math.round(n));
}

/** Plain-language lines explaining input toward daily limit (EN default). */
export function formatInputLimitExplanation(
  b: InputLimitBreakdown,
  opts?: { lang?: UsageLang; dailyLimit?: number; indent?: string },
): string {
  const lang = opts?.lang === "id" ? "id" : "en";
  const ind = opts?.indent ?? "";
  const lim =
    opts?.dailyLimit && opts.dailyLimit > 0
      ? ` / ${fmtTok(opts.dailyLimit, lang)}`
      : "";
  const w = b.weightPercent;

  if (lang === "id") {
    const lines = [
      `${ind}📥 Input menuju limit harian: **${fmtTok(b.inputTowardLimit, lang)}**${lim}`,
      `${ind}`,
      `${ind}Dari mana angka itu? (dari pemakaian menuju limit harian):`,
      `${ind}• ${b.promptCount} prompt (pesan kamu)`,
      `${ind}  rata-rata ~${fmtTok(b.avgInPerPrompt, lang)} × 100% = **${fmtTok(b.creditPrompts, lang)}**`,
      `${ind}• ${b.followUpCount} panggilan API lanjutan (AI baca/tulis file dll.)`,
      `${ind}  = ${b.apiCallCount} total API − ${b.promptCount} prompt`,
      `${ind}  rata-rata ~${fmtTok(b.avgInPerFollowUp, lang)} × ${w}% = **${fmtTok(b.creditFollowUps, lang)}**`,
      `${ind}• Total ke limit: ${fmtTok(b.creditPrompts, lang)} + ${fmtTok(b.creditFollowUps, lang)} = **${fmtTok(b.inputTowardLimit, lang)}**`,
    ];
    if (b.peakFullIn > 0) {
      lines.push(
        `${ind}`,
        `${ind}📌 Ukuran chat mentah (BUKAN penjumlahan ke limit):`,
        `${ind}Puncak per giliran ~${fmtTok(b.peakFullIn, lang)} token`,
        `${ind}(~${fmtTok(b.peakBillable, lang)} baru + ~${fmtTok(b.peakCached, lang)} cache/riwayat)`,
      );
    }
    return lines.join("\n");
  }

  const lines = [
    `${ind}📥 Input toward your daily limit: **${fmtTok(b.inputTowardLimit, lang)}**${lim}`,
    `${ind}`,
    `${ind}How we got ${fmtTok(b.inputTowardLimit, lang)} (from your usage toward the daily limit):`,
    `${ind}• ${b.promptCount} prompts (your messages)`,
    `${ind}  avg ~${fmtTok(b.avgInPerPrompt, lang)} each × 100% = **${fmtTok(b.creditPrompts, lang)}**`,
    `${ind}• ${b.followUpCount} follow-up API calls (AI tools: read/write/etc.)`,
    `${ind}  = ${b.apiCallCount} total API calls − ${b.promptCount} prompts`,
    `${ind}  avg ~${fmtTok(b.avgInPerFollowUp, lang)} each × ${w}% = **${fmtTok(b.creditFollowUps, lang)}**`,
    `${ind}• Total toward limit: ${fmtTok(b.creditPrompts, lang)} + ${fmtTok(b.creditFollowUps, lang)} = **${fmtTok(b.inputTowardLimit, lang)}**`,
  ];
  if (b.peakFullIn > 0) {
    lines.push(
      `${ind}`,
      `${ind}📌 Chat size note (raw tokens — does NOT add up to the limit number):`,
      `${ind}A typical turn peaks around ~${fmtTok(b.peakFullIn, lang)} tokens`,
      `${ind}(~${fmtTok(b.peakBillable, lang)} new + ~${fmtTok(b.peakCached, lang)} cache/history)`,
    );
  }
  return lines.join("\n");
}

/** Compact one-liner for portal/admin sublabels. */
export function formatInputLimitSublabel(
  b: InputLimitBreakdown,
  opts?: { lang?: UsageLang },
): string {
  const lang = opts?.lang === "id" ? "id" : "en";
  if (b.apiCallCount <= 0) {
    return lang === "id" ? "belum ada pemakaian hari ini" : "no usage today yet";
  }
  if (lang === "id") {
    return (
      `${b.promptCount} prompt × ~${fmtTok(b.avgInPerPrompt, lang)} @100%` +
      ` + ${b.followUpCount} lanjutan × ~${fmtTok(b.avgInPerFollowUp, lang)} @${b.weightPercent}%` +
      ` = ${fmtTok(b.inputTowardLimit, lang)}` +
      (b.peakFullIn > 0
        ? ` · puncak chat ~${fmtTok(b.peakFullIn, lang)} (info)`
        : "")
    );
  }
  return (
    `${b.promptCount} prompts × ~${fmtTok(b.avgInPerPrompt, lang)} @100%` +
    ` + ${b.followUpCount} follow-ups × ~${fmtTok(b.avgInPerFollowUp, lang)} @${b.weightPercent}%` +
    ` = ${fmtTok(b.inputTowardLimit, lang)}` +
    (b.peakFullIn > 0
      ? ` · typical chat peak ~${fmtTok(b.peakFullIn, lang)} (info)`
      : "")
  );
}
