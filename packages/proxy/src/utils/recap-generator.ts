/**
 * Monthly Recap AI narrative generator.
 *
 * PRIVACY GUARD: Only aggregate numeric/category metrics from RecapStats are
 * ever sent to the model. NO conversation content, topics, previews, or error
 * text. The prompt builder below receives only the sanitized stats object.
 *
 * Uses the proxy's OWN /v1/chat/completions with model "auto" and a dedicated
 * system API key (RECAP_API_KEY) so it does not pollute user statistics.
 */

import type { RecapStats } from "./recap-stats.js";
import type { RecapAsset } from "./recap-assets.js";

export interface RecapNarrative {
  persona: { title: string; subtitle: string };
  sections: Record<string, { headline: string; caption: string; assetId?: string }>;
  closing: string;
  /** asset ids chosen by the AI, validated against the manifest before use. */
  assetChoices: Record<string, string>;
}

const SECTION_KEYS = [
  "intro",
  "requests",
  "tokens",
  "favoriteModel",
  "leastModel",
  "activeTime",
  "persona",
  "rank",
  "ide",
  "closing",
] as const;

/** Persona signal derived deterministically; AI embellishes around it. */
export function derivePersona(stats: RecapStats): { key: string; title: string; hint: string } {
  const ratio = stats.totals.ioRatio;
  const req = stats.totals.requests;
  if (req === 0) {
    return { key: "ghost", title: "Si Hantu", hint: "nyaris nggak ngoding bulan ini" };
  }
  if (ratio < 0.15) {
    return { key: "boros", title: "Si Boros Konteks", hint: "input gede banget, boros tools/context, output dikit" };
  }
  if (ratio < 0.45) {
    return { key: "balanced", title: "Coder Santai", hint: "input-output seimbang, gaya ngoding biasa" };
  }
  return { key: "pro", title: "Master Prompt", hint: "output mendekati/lebih dari input, prompting efisien & pro" };
}

/** Most-active-hour persona flavor. */
function timePersona(hour: number | null): string {
  if (hour === null) return "waktu acak";
  if (hour >= 0 && hour < 5) return "Kalong Malam (begadang ngoding)";
  if (hour < 11) return "Pagi Produktif";
  if (hour < 15) return "Tim Siang";
  if (hour < 19) return "Sore Santuy";
  return "Malam Hari";
}

/** Rank tier flavor for memes. */
function rankTier(rank: number): string {
  if (rank === 0) return "belum masuk peringkat";
  if (rank === 1) return "RAJA/RATU (peringkat 1, nyawitt total, mecut AI tiada henti)";
  if (rank <= 3) return "podium (top 3, sultan token)";
  if (rank <= 5) return "top 5 (rajin banget, mecut AI)";
  if (rank <= 10) return "top 10 (kuat, langganan AI)";
  return "peserta aktif";
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

/**
 * Build a compact, PRIVACY-SAFE summary string of the user's month.
 * Only numbers and category labels. Used as the model input.
 */
export function buildStatsSummary(stats: RecapStats, monthLabel: string): string {
  const persona = derivePersona(stats);
  const lines: string[] = [];
  lines.push(`Bulan: ${monthLabel}`);
  lines.push(`Total request: ${stats.totals.requests}`);
  lines.push(`Input token: ${stats.totals.inputTokens}, Output token: ${stats.totals.outputTokens}, Total: ${stats.totals.totalTokens}`);
  lines.push(`Rasio output/input: ${stats.totals.ioRatio.toFixed(2)} -> persona: ${persona.title} (${persona.hint})`);
  lines.push(`Rata-rata token/request: ${stats.totals.avgTokensPerRequest}`);
  lines.push(`Model favorit: ${stats.models.favorite ?? "-"}; jumlah model unik: ${stats.models.uniqueCount}`);
  lines.push(`Top model: ${stats.models.top.map((m) => `${m.model}(${m.requests}x)`).join(", ") || "-"}`);
  if (stats.models.leastUsed.length) {
    lines.push(`Model paling jarang: ${stats.models.leastUsed.map((m) => `${m.model}(${m.requests}x)`).join(", ")}`);
  }
  if (stats.models.fastest) lines.push(`Model tercepat: ${stats.models.fastest.model} (${stats.models.fastest.avgLatencyMs}ms)`);
  if (stats.models.slowest) lines.push(`Model terlama: ${stats.models.slowest.model} (${stats.models.slowest.avgLatencyMs}ms)`);
  if (stats.activity.mostActiveDay) lines.push(`Hari paling aktif: ${stats.activity.mostActiveDay.day} (${stats.activity.mostActiveDay.requests} request)`);
  if (stats.activity.mostActiveHour) lines.push(`Jam paling aktif: ${stats.activity.mostActiveHour.hour}:00 WIB (${timePersona(stats.activity.mostActiveHour.hour)})`);
  if (stats.activity.favoriteWeekday) lines.push(`Hari favorit: ${stats.activity.favoriteWeekday}`);
  lines.push(`Hari aktif: ${stats.activity.activeDays}, streak terpanjang: ${stats.activity.longestStreak} hari`);
  lines.push(`Weekend vs weekday request: ${stats.activity.weekendRequests} vs ${stats.activity.weekdayRequests}`);
  lines.push(`Sesi chat: ${stats.sessions.count}, rata-rata request/sesi: ${stats.sessions.avgRequestsPerSession}`);
  lines.push(`IDE favorit: ${stats.ide.favorite ?? "-"}; jumlah IDE: ${stats.ide.uniqueCount}`);
  lines.push(`Device dipakai: ${stats.devices.uniqueCount}`);
  lines.push(`Tool calls: ${stats.tools.totalToolCalls}, % turn pakai tool: ${stats.tools.toolTurnPercent}%`);
  lines.push(`Latency rata-rata: ${stats.latency.avgMs}ms (tercepat ${stats.latency.fastestMs}ms, terlama ${stats.latency.slowestMs}ms)`);
  lines.push(`Error rate: ${stats.errors.errorPercent}%`);
  lines.push(`Peringkat request: ${stats.rank.requests || "-"} dari ${stats.rank.totalParticipants} (${rankTier(stats.rank.requests)})`);
  lines.push(`Peringkat token: ${stats.rank.tokens || "-"} dari ${stats.rank.totalParticipants}`);
  if (stats.comparison.hasPrev) {
    lines.push(`Vs bulan lalu: request ${stats.comparison.requestsDeltaPercent >= 0 ? "+" : ""}${stats.comparison.requestsDeltaPercent}%, token ${stats.comparison.tokensDeltaPercent >= 0 ? "+" : ""}${stats.comparison.tokensDeltaPercent}%`);
  }
  return lines.join("\n");
}

/** Deterministic template narrative used when AI is unavailable or invalid. */
export function templateNarrative(stats: RecapStats, monthLabel: string, assets: RecapAsset[]): RecapNarrative {
  const persona = derivePersona(stats);
  const pick = (category: string): string | undefined => {
    const a = assets.find((x) => x.category === category);
    return a?.id;
  };
  const sections: RecapNarrative["sections"] = {
    intro: { headline: `Recap ${monthLabel}`, caption: "Yuk lihat perjalanan ngoding kamu bulan ini!", assetId: pick("misc") },
    requests: { headline: `${fmtNum(stats.totals.requests)} request`, caption: `Kamu mecut AI sebanyak ${stats.totals.requests} kali.`, assetId: pick("reactions") },
    tokens: { headline: `${fmtNum(stats.totals.totalTokens)} token`, caption: `Input ${fmtNum(stats.totals.inputTokens)} - Output ${fmtNum(stats.totals.outputTokens)}.`, assetId: pick("personas") },
    favoriteModel: { headline: stats.models.favorite ?? "-", caption: "Model andalan kamu bulan ini.", assetId: pick("models") },
    leastModel: { headline: stats.models.leastUsed[0]?.model ?? "-", caption: "Model yang jarang kamu sentuh. Kita kan teman?", assetId: pick("models") },
    activeTime: { headline: stats.activity.mostActiveHour ? `${stats.activity.mostActiveHour.hour}:00 WIB` : "-", caption: `Waktu paling produktif kamu: ${timePersona(stats.activity.mostActiveHour?.hour ?? null)}.`, assetId: pick("time") },
    persona: { headline: persona.title, caption: persona.hint, assetId: pick("personas") },
    rank: { headline: stats.rank.requests ? `Peringkat #${stats.rank.requests}` : "Belum berperingkat", caption: rankTier(stats.rank.requests), assetId: pick("ranks") },
    ide: { headline: stats.ide.favorite ?? "-", caption: `IDE favorit kamu, dari ${stats.ide.uniqueCount} IDE.`, assetId: pick("misc") },
    closing: { headline: "Sampai jumpa bulan depan!", caption: "Terus ngoding bareng AI ya.", assetId: pick("confetti") },
  };
  const assetChoices: Record<string, string> = {};
  for (const k of SECTION_KEYS) {
    const id = sections[k]?.assetId;
    if (id) assetChoices[k] = id;
  }
  return {
    persona: { title: persona.title, subtitle: persona.hint },
    sections,
    closing: "Sampai jumpa bulan depan!",
    assetChoices,
  };
}

/** Validate AI-chosen asset ids against the manifest; fallback by section's category. */
function validateAssetChoices(
  raw: Record<string, any>,
  assets: RecapAsset[],
  fallback: RecapNarrative,
): Record<string, string> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const out: Record<string, string> = {};
  for (const k of SECTION_KEYS) {
    const chosen = raw?.[k];
    if (typeof chosen === "string" && byId.has(chosen)) {
      out[k] = chosen;
    } else if (fallback.assetChoices[k]) {
      out[k] = fallback.assetChoices[k];
    }
  }
  return out;
}

const SYSTEM_PROMPT = `Kamu adalah penulis "recap bulanan" gaya Spotify Wrapped untuk developer yang pakai AI coding.
Gaya: Bahasa Indonesia gaul, lucu, meme, hangat, sedikit nyindir tapi tetap positif.
Kamu HANYA menerima statistik angka & kategori. JANGAN mengarang isi percakapan/topik.
Output WAJIB JSON valid sesuai skema. Tiap user harus terasa beda tergantung angka & rankingnya.
Pilih assetId dari daftar yang diberikan (pakai field "id"), cocokkan dengan vibe tiap section.`;

function buildUserPrompt(summary: string, assets: RecapAsset[]): string {
  const assetList = assets.map((a) => `${a.id} [${a.category}] tags:${(a.tags || []).join("/")}`).join("\n");
  return `STATISTIK USER (aggregate, tanpa konten):
${summary}

DAFTAR ASSET (pilih id yang cocok per section):
${assetList}

Buat JSON dengan struktur PERSIS:
{
  "persona": { "title": "...", "subtitle": "..." },
  "sections": {
    "intro": { "headline": "...", "caption": "...", "assetId": "..." },
    "requests": { "headline": "...", "caption": "...", "assetId": "..." },
    "tokens": { "headline": "...", "caption": "...", "assetId": "..." },
    "favoriteModel": { "headline": "...", "caption": "...", "assetId": "..." },
    "leastModel": { "headline": "...", "caption": "...", "assetId": "..." },
    "activeTime": { "headline": "...", "caption": "...", "assetId": "..." },
    "persona": { "headline": "...", "caption": "...", "assetId": "..." },
    "rank": { "headline": "...", "caption": "...", "assetId": "..." },
    "ide": { "headline": "...", "caption": "...", "assetId": "..." },
    "closing": { "headline": "...", "caption": "...", "assetId": "..." }
  },
  "closing": "..."
}
headline singkat (max ~40 char), caption 1-2 kalimat lucu. HANYA JSON, tanpa teks lain.`;
}

/** Extract a JSON object from a model response that may contain code fences. */
function parseJsonLoose(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(t.slice(first, last + 1));
  } catch {
    return null;
  }
}

/**
 * Generate the recap narrative via the proxy's own auto model.
 * Falls back to a deterministic template on any error / invalid output.
 */
export async function generateNarrative(
  stats: RecapStats,
  monthLabel: string,
  assets: RecapAsset[],
): Promise<RecapNarrative> {
  const fallback = templateNarrative(stats, monthLabel, assets);
  const apiKey = process.env.RECAP_API_KEY;
  const baseUrl = process.env.PROXY_INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`;
  if (!apiKey) return fallback;

  const summary = buildStatsSummary(stats, monthLabel);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "auto",
        temperature: 1.0,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(summary, assets) },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return fallback;
    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseJsonLoose(typeof content === "string" ? content : "");
    if (!parsed || typeof parsed !== "object" || !parsed.sections) return fallback;

    // Merge: prefer AI text but guarantee every section exists (fallback fills gaps).
    const sections: RecapNarrative["sections"] = { ...fallback.sections };
    for (const k of SECTION_KEYS) {
      const s = parsed.sections?.[k];
      if (s && typeof s.headline === "string" && typeof s.caption === "string") {
        sections[k] = { headline: String(s.headline).slice(0, 80), caption: String(s.caption).slice(0, 280), assetId: typeof s.assetId === "string" ? s.assetId : undefined };
      }
    }

    const rawChoices: Record<string, any> = {};
    for (const k of SECTION_KEYS) rawChoices[k] = parsed.sections?.[k]?.assetId;
    const assetChoices = validateAssetChoices(rawChoices, assets, fallback);
    for (const k of SECTION_KEYS) {
      if (sections[k]) sections[k].assetId = assetChoices[k];
    }

    return {
      persona: {
        title: typeof parsed.persona?.title === "string" ? String(parsed.persona.title).slice(0, 60) : fallback.persona.title,
        subtitle: typeof parsed.persona?.subtitle === "string" ? String(parsed.persona.subtitle).slice(0, 120) : fallback.persona.subtitle,
      },
      sections,
      closing: typeof parsed.closing === "string" ? String(parsed.closing).slice(0, 200) : fallback.closing,
      assetChoices,
    };
  } catch {
    return fallback;
  }
}

