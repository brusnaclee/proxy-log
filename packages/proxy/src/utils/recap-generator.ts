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
  /** resolved GIF URLs per section (realtime search at generate time). */
  gifs?: Record<string, string>;
  /** AI-generated badges (creative, max 10), validated; falls back to deterministic. */
  badges?: Array<{ icon: string; title: string; desc: string }>;
  /** Card meta: live anime wallpaper + nested glass tile plan. */
  card?: import("./recap-card-meta.js").CardMeta | null;
  /** AI-driven per-user layout decisions. Section ORDER is fixed; these hints
   *  only change the visual emphasis inside each page (anchor tile, chip
   *  spotlight, persona tone, community focus) and the page-level mood/hero. */
  layoutHints?: {
    hero?: "stats" | "rank" | "activeTime" | "favoriteModel" | "persona";
    mood?: "energetic" | "calm" | "wild" | "mysterious";
    hiddenSections?: string[];
    gridAccent?: "tools" | "activity" | "sessions" | "latency";
    chipsHighlight?: "ide" | "delta" | "none";
    personaTone?: "playful" | "humble" | "confident";
    communityFocus?: "request" | "token";
  } | null;
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

/**
 * Persona derived from RELATIVE position in the population (percentiles) plus
 * distinctive traits, then the highest-scoring trait wins so users vary.
 */
export function derivePersona(stats: RecapStats): { key: string; title: string; hint: string } {
  const req = stats.totals.requests;
  if (req === 0) {
    return { key: "ghost", title: "Si Hantu", hint: "nyaris nggak ngoding bulan ini" };
  }

  const pop = stats.population;
  const ratio = stats.totals.ioRatio;
  const rankReq = stats.rank.requests || 9999;
  const a = stats.activity;
  const nightShare = a.perHour && a.perHour.length
    ? a.perHour.filter((h) => h.hour >= 0 && h.hour < 5).reduce((s, h) => s + h.requests, 0) / Math.max(req, 1)
    : 0;
  const morningShare = a.perHour && a.perHour.length
    ? a.perHour.filter((h) => h.hour >= 5 && h.hour < 9).reduce((s, h) => s + h.requests, 0) / Math.max(req, 1)
    : 0;
  const topModelShare = stats.models.top[0] ? stats.models.top[0].requests / Math.max(req, 1) : 0;
  const toolPct = stats.tools.toolTurnPercent || 0;
  const uniqueModels = stats.models.uniqueCount || 0;

  // Candidate personas with a score; highest wins. Relative thresholds use
  // population percentiles when available, with sensible absolute fallbacks.
  const reqP90 = pop?.requestsP90 ?? Infinity;
  const reqP75 = pop?.requestsP75 ?? Infinity;
  const tokP90 = pop?.tokensP90 ?? Infinity;
  const ratioP75 = pop?.ratioP75 ?? 0.5;
  const ratioP25 = pop?.ratioP25 ?? 0.05;

  type Cand = { key: string; title: string; hint: string; score: number };
  const cands: Cand[] = [];

  if (rankReq === 1) cands.push({ key: "raja", title: "Raja Mecut AI", hint: "peringkat 1 request, nyawitt tiada henti", score: 100 });
  if (rankReq <= 3) cands.push({ key: "podium", title: "Penghuni Podium", hint: "top 3, sultan sejati", score: 90 });
  if (stats.totals.totalTokens >= tokP90) cands.push({ key: "sultan", title: "Sultan Token", hint: "konsumsi token papan atas", score: 78 });
  if (req >= reqP90) cands.push({ key: "mesin", title: "Mesin Tanpa Henti", hint: "volume request paling tinggi", score: 76 });
  if (nightShare >= 0.35) cands.push({ key: "kalong", title: "Kalong Malam", hint: "paling aktif jam 00-05, anti tidur", score: 72 });
  if (morningShare >= 0.35) cands.push({ key: "subuh", title: "Pejuang Subuh", hint: "ngoding pas orang lain masih merem", score: 66 });
  if (ratio >= ratioP75 && ratio >= 0.25) cands.push({ key: "pro", title: "Master Prompt", hint: "output efisien relatif komunitas, prompting rapi", score: 70 });
  if (uniqueModels >= 6) cands.push({ key: "penjelajah", title: "Penjelajah Model", hint: `nyobain ${uniqueModels} model berbeda`, score: 64 });
  if (topModelShare >= 0.8) cands.push({ key: "setia", title: "Setia Satu Model", hint: "cinta mati sama satu model", score: 60 });
  if (toolPct >= 60) cands.push({ key: "vibe", title: "Vibe Coder Sejati", hint: `${toolPct}% turn pakai tool, agentic abis`, score: 62 });
  if (a.longestStreak >= 7) cands.push({ key: "konsisten", title: "Si Konsisten", hint: `streak ${a.longestStreak} hari beruntun`, score: 58 });
  if (a.activeDays >= 20) cands.push({ key: "rajin", title: "Anak Rajin", hint: `aktif ${a.activeDays} hari sebulan`, score: 56 });
  // Only the genuine bottom quartile of ratio = boros (not everyone).
  if (ratio <= ratioP25 && req >= (reqP75 === Infinity ? 50 : reqP75)) {
    cands.push({ key: "boros", title: "Tukang Suapin Konteks", hint: "konteks segede gaban tapi minta output secuil", score: 54 });
  }
  if (req < (pop?.requestsP75 ? pop.requestsP75 * 0.25 : 20)) {
    cands.push({ key: "kalem", title: "Si Kalem", hint: "santai, secukupnya aja", score: 30 });
  }

  // Fallback baseline so there's always a result.
  cands.push({ key: "balanced", title: "Coder Andalan", hint: "ritme ngoding yang solid & seimbang", score: 40 });

  cands.sort((x, y) => y.score - x.score);
  return cands[0];
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
  if (stats.population) {
    const p = stats.population;
    lines.push(`Konteks komunitas: ${p.participants} user aktif; rasio median ${p.medianRatio.toFixed(2)} (p25 ${p.ratioP25.toFixed(2)}, p75 ${p.ratioP75.toFixed(2)}); request p90 ${Math.round(p.requestsP90)}; token p90 ${Math.round(p.tokensP90)}.`);
    lines.push(`(Catatan: input>>output itu NORMAL untuk coding agent. Jangan auto-cap "boros" kecuali persona memang boros.)`);
  }
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
  // Seed from numbers so the same user gets stable (but varied vs others) lines.
  const seed = (stats.totals.requests * 31 + stats.totals.totalTokens + (stats.rank.requests || 0) * 7) >>> 0;
  const ch = <T,>(arr: T[]): T => arr[seed % arr.length];
  const req = stats.totals.requests;
  const tok = stats.totals.totalTokens;
  const inTok = stats.totals.inputTokens;
  const outTok = stats.totals.outputTokens;
  const fav = stats.models.favorite ?? "-";
  const least = stats.models.leastUsed[0]?.model;
  const hr = stats.activity.mostActiveHour?.hour ?? null;
  const rankR = stats.rank.requests;

  const sections: RecapNarrative["sections"] = {
    intro: {
      headline: ch([`Wrapped ${monthLabel}`, `Rekap ${monthLabel}`, `${monthLabel}, Dirangkum`]),
      caption: ch([
        "Sebulan penuh drama lo sama AI, kerangkum di sini.",
        "Jejak ngoding lo bulan ini, no skip.",
        "Mari kita buka rapor bulanan lo.",
      ]),
      assetId: pick("misc"),
    },
    requests: {
      headline: `${fmtNum(req)} request`,
      caption: req >= 1000
        ? ch([`${req.toLocaleString("id-ID")} kali mencet enter. AI lo butuh libur.`, `${fmtNum(req)} request — lo bukan ngoding, lo nyiksa AI.`])
        : ch([`${req} request bulan ini. Kalem tapi jalan.`, `${req} kali manggil AI. Secukupnya, gaya hemat.`]),
      assetId: pick("reactions"),
    },
    tokens: {
      headline: `${fmtNum(tok)} token`,
      caption: ch([
        `Input ${fmtNum(inTok)}, output ${fmtNum(outTok)}. ${inTok > outTok * 8 ? "Lo suapin konteks segunung." : "Lumayan imbang sih."}`,
        `${fmtNum(tok)} token kebakar. Dompet provider nangis.`,
      ]),
      assetId: pick("personas"),
    },
    favoriteModel: {
      headline: String(fav),
      caption: ch([`${fav} jadi tmeng-andalan lo. Setia banget.`, `Kemana-mana ${fav}. Udah kayak pacar.`]),
      assetId: pick("models"),
    },
    leastModel: {
      headline: least ?? "-",
      caption: least ? ch([`${least} cuma lo colek sekali. Kasian.`, `${least} dianaktirikan. Kita kan temen?`]) : "Lo cuma pakai satu model. Loyal abis.",
      assetId: pick("models"),
    },
    activeTime: {
      headline: hr !== null ? `${hr}:00 WIB` : "-",
      caption: hr === null ? "Jam ngoding lo random, susah ditebak." : ch([
        `Paling sering ngoding jam ${hr}. ${hr < 5 ? "Tidur itu opsional ya." : hr < 9 ? "Tim subuh sejati." : "Jam produktif klasik."}`,
        `Jam ${hr} jadi prime time lo.`,
      ]),
      assetId: pick("time"),
    },
    persona: { headline: persona.title, caption: persona.hint, assetId: pick("personas") },
    rank: {
      headline: rankR ? `Peringkat #${rankR}` : "Belum berperingkat",
      caption: rankTier(rankR),
      assetId: pick("ranks"),
    },
    ide: {
      headline: stats.ide.favorite ?? "-",
      caption: stats.ide.uniqueCount > 1 ? `${stats.ide.favorite} juara, dari ${stats.ide.uniqueCount} IDE yang lo cobain.` : `Setia di ${stats.ide.favorite ?? "satu IDE"}.`,
      assetId: pick("misc"),
    },
    closing: {
      headline: ch(["Sampai jumpa bulan depan!", "Lanjut bulan depan ya!", "Gas terus!"]),
      caption: ch(["Jangan lupa istirahat, AI-nya udah capek.", "Bulan depan kita ngebut lagi."]),
      assetId: pick("confetti"),
    },
  };
  const assetChoices: Record<string, string> = {};
  for (const k of SECTION_KEYS) {
    const id = sections[k]?.assetId;
    if (id) assetChoices[k] = id;
  }
  return {
    persona: { title: persona.title, subtitle: persona.hint },
    sections,
    closing: sections.closing.headline,
    assetChoices,
  };
}

/** Strip non-Latin garbage (CJK/mojibake) the model sometimes injects; keep Indonesian/emoji. */
function sanitizeText(s: string): string {
  return String(s)
    // remove CJK / Hangul / Hiragana / Katakana blocks
    .replace(/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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

const SYSTEM_PROMPT = `Lo penulis "Wrapped" bulanan buat developer yang ngoding pake AI. Bayangin lo temen sebticket yang savage nge-roast tapi diam-diam bangga sama temennya.

SUARA & GAYA:
- Bahasa Indonesia gaul sehari-hari (lo/gue/kamu boleh, santai), nyeleneh, meme, relatable anak tech.
- ROAST DULU, puji belakangan. Spesifik ke ANGKA user, sebut angkanya, bandingin, sindir pedes tapi lucu. Contoh: "3.208 request? AI lo butuh cuti, lo butuh terapi." / "Output 19M dari input 175M? Lo ngasih ensiklopedia minta jawaban satu kata."
- Boleh absurd/hiperbola, sarkas, bikin user ketawa sambil mikir "anjir bener juga".
- VARIASIKAN tiap user — jangan pernah pola kalimat yang sama. Tiap section beda angle.

DILARANG KERAS (kedengeran AI/template/garing):
- "Yuk lihat perjalanan ngoding kamu", "Mari kita intip", "Berikut adalah", "Di bulan ini kamu telah", "Luar biasa", "Keren banget".
- Kalimat motivasi generik tanpa angka.
- Emoji bertabur (maksimal 1 emoji per caption, sering malah 0).

ATURAN:
- HANYA terima statistik angka/kategori. JANGAN ngarang isi percakapan/topik kerjaan.
- Tetap sopan: no SARA, no body-shaming, no kata kasar berlebihan. Roast soal kebiasaan ngoding aja.
- Output WAJIB JSON valid sesuai skema. Pilih assetId dari daftar (pakai field "id"), cocokin sama vibe section.
- headline: super singkat & punchy (<= 38 char). caption: 1-2 kalimat, spesifik nyebut angka, savage tapi lucu, layak di-screenshot.`;

function buildUserPrompt(summary: string, assets: RecapAsset[]): string {
  const assetList = assets.map((a) => `${a.id} [${a.category}] tags:${(a.tags || []).join("/")}`).join("\n");
  return `STATISTIK USER (aggregate, tanpa konten):
${summary}

DAFTAR ASSET (pilih id yang paling nyambung sama vibe tiap section):
${assetList}

Tulis recap yang terasa DITULIS MANUSIA, bukan AI. Nyebut angka spesifik di atas, roast halus, beda dari user lain.

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
  "badges": [ { "icon": "<1 emoji>", "title": "<max 24 char, kreatif & relevan ke angka>", "desc": "<max 60 char, lucu>" } ],
  "closing": "...",
  "layoutHints": {
    "hero": "<stats|rank|activeTime|favoriteModel|persona>",
    "mood": "<energetic|calm|wild|mysterious>",
    "hiddenSections": ["<sectionId>", "..."],
    "gridAccent": "<tools|activity|sessions|latency>",
    "chipsHighlight": "<ide|delta|none>",
    "personaTone": "<playful|humble|confident>",
    "communityFocus": "<request|token>"
  }
}
ATURAN BADGE: 3-10 badge, tiap badge HARUS punya 1 emoji unik + judul kreatif yang nyambung ke statistik user (jangan generik), desc singkat lucu. Variasikan tiap user.

ATURAN LAYOUT HINTS (keputusan layout visual per user — ini bukan caption, ini kendali UI):
- "hero": section mana yang PALING KUAT untuk user ini (paling banyak request → "stats"; rank tinggi → "rank"; malam hari → "activeTime"; model spesifik → "favoriteModel"; persona kuat → "persona"). Default: "stats".
- "mood": nuansa vibe user. Default "energetic".
  - "energetic": user aktif produktif, request tinggi, default
  - "calm": user santai, weekend-heavy, output ratio tinggi, sesi panjang
  - "wild": user tidak teratur, request meledak di jam tertentu, sangat tidak均衡
  - "mysterious": user minim data (baru, < 5 hari aktif, < 50 request)
- "hiddenSections": section yang bisa di-skip (contoh: user < 5 hari aktif → hide "Hari Santai" & "Fun Facts" atau "modelSpeed" kalau model < 2). Pilih dari sectionId yang dikenal: "intro","stats","favoriteModel","leastModel","modelSpeed","activeTime","persona","grid","ach","facts","heatmap","rest","community","rank","ide","closing".
- "reorderTop": urutan 3 section pertama. Misal top-3 user → ["rank","stats","persona"]; user nokturnal → ["activeTime","stats","persona"]. Max 3 section.
ATURAN LAYOUT HINTS (keputusan layout visual per user — kendali UI, bukan caption):
SECTION ORDER TIDAK BOLEH DIUBAH. Jangan isi field "reorderTop" atau saran apapun untuk menukar urutan section. Urutan dari atas ke bawah adalah: intro → stats → favoriteModel → leastModel → modelSpeed → activeTime → persona → grid → ach → facts → heatmap → rest → community → rank → latency → projection → race → leaderboard → card → closing. Adaptasi per user HANYA boleh di level:
  1. Pilih section mana yang paling kuat secara visual ("hero")
  2. Tema warna & animasi ("mood")
  3. Section mana yang benar-benar kosong/tidak relevan untuk di-hide ("hiddenSections")
  4. PENEMPATAN visual DI DALAM halaman ("gridAccent", "chipsHighlight", "personaTone", "communityFocus")

- "hero": section PALING KUAT untuk user ini (request banyak → "stats"; rank tinggi → "rank"; malam hari → "activeTime"; model spesifik → "favoriteModel"; persona kuat → "persona"). Default: "stats".
- "mood": nuansa vibe user. Default "energetic".
  - "energetic": user aktif produktif, request tinggi, default
  - "calm": user santai, weekend-heavy, output ratio tinggi, sesi panjang
  - "wild": user tidak teratur, request meledak di jam tertentu, sangat variatif
  - "mysterious": user minim data (baru, < 5 hari aktif, < 50 request)
- "hiddenSections": section yang bisa di-skip karena datanya kosong/tidak relevan (contoh: < 5 hari aktif → hide "rest"/"facts"; rank data kosong → hide "race"/"leaderboard"/"community"). Pilih dari: "intro","stats","favoriteModel","leastModel","modelSpeed","activeTime","persona","grid","ach","facts","heatmap","rest","community","rank","latency","projection","race","leaderboard","card","closing".
- "gridAccent": tile mana yang jadi ANCHOR 2x2 (spotlight) di halaman "Angka Lain". Pilih berdasarkan karakter user:
  - "tools": user agentic (tool% >= 50 atau tool calls tinggi) → "Tool calls" jadi b2-anchor
  - "activity": user baru/kasual (active days < 7 atau request rendah) → "Hari aktif" jadi b2-anchor
  - "sessions": user yang banyak ngobrol (sessions.count tinggi) → "Sesi chat" jadi b2-anchor
  - "latency": user yang sering nunggu (latency tinggi atau variasi ekstrim) → "Latency (ms)" jadi b2-anchor
  - Default: "tools"
- "chipsHighlight": chip mana di baris bawah "Angka Lain" yang paling mencolok. Pilih SATU:
  - "ide": untuk power user (punya IDE favorit, request > 200) → IDE favorit chip jadi chip--hero
  - "delta": untuk yang suka compare tren (ada comparison.hasPrev DAN delta signifikan) → delta chip jadi chip--hero
  - "none": untuk user kasual/baru → tidak ada chip yang di-highlight
  - Default: "ide"
- "personaTone": tone caption di halaman "Tipe Kamu":
  - "playful": user baru/kasual, ramai, suka bercanda
  - "humble": user mid-tier, konsisten, santai
  - "confident": user power/berperingkat tinggi, dominan
  - Default: "humble"
- "communityFocus": di halaman "Kamu vs Komunitas", percentile mana yang di-highlight:
  - "request": user yang bangga dengan volume request (default, untuk user aktif)
  - "token": user yang sadar biaya/token (untuk user dengan token tinggi atau ratio output tinggi)
  - Default: "request"


HANYA JSON, tanpa teks lain, tanpa code fence.`;
}

/** Validate AI badges: need emoji + title + desc, cap length, max 10, fallback if empty. */
function validateBadges(raw: any, fallback: Array<{ icon: string; title: string; desc: string }> | undefined): Array<{ icon: string; title: string; desc: string }> {
  const out: Array<{ icon: string; title: string; desc: string }> = [];
  if (Array.isArray(raw)) {
    for (const b of raw) {
      if (!b || typeof b !== "object") continue;
      const icon = sanitizeText(String(b.icon || "")).slice(0, 4).trim();
      const title = sanitizeText(String(b.title || "")).slice(0, 28).trim();
      const desc = sanitizeText(String(b.desc || "")).slice(0, 70).trim();
      if (!icon || !title) continue;
      out.push({ icon, title, desc });
      if (out.length >= 10) break;
    }
  }
  return out.length ? out : (fallback || []);
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
  opts: { retries?: number } = {},
): Promise<{ ok: boolean; narrative: RecapNarrative }> {
  const fallback = templateNarrative(stats, monthLabel, assets);
  const apiKey = process.env.RECAP_API_KEY;
  const baseUrl = process.env.PROXY_INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`;
  if (!apiKey) return { ok: false, narrative: fallback };

  const summary = buildStatsSummary(stats, monthLabel);
  const maxAttempts = Math.max(1, opts.retries ?? 30);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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

      if (!res.ok) { await backoff(attempt); continue; }
      const data = await res.json().catch(() => null);
      const content = data?.choices?.[0]?.message?.content;
      const parsed = parseJsonLoose(typeof content === "string" ? content : "");
      if (!parsed || typeof parsed !== "object" || !parsed.sections) { await backoff(attempt); continue; }

      // Merge: prefer AI text but guarantee every section exists (fallback fills gaps).
      const sections: RecapNarrative["sections"] = { ...fallback.sections };
      for (const k of SECTION_KEYS) {
        const s = parsed.sections?.[k];
        if (s && typeof s.headline === "string" && typeof s.caption === "string") {
          sections[k] = { headline: sanitizeText(String(s.headline)).slice(0, 80), caption: sanitizeText(String(s.caption)).slice(0, 280), assetId: typeof s.assetId === "string" ? s.assetId : undefined };
        }
      }

      const rawChoices: Record<string, any> = {};
      for (const k of SECTION_KEYS) rawChoices[k] = parsed.sections?.[k]?.assetId;
      const assetChoices = validateAssetChoices(rawChoices, assets, fallback);
      for (const k of SECTION_KEYS) {
        if (sections[k]) sections[k].assetId = assetChoices[k];
      }

      // Extract AI-driven layout hints (validated, with safe defaults)
      const VALID_HERO = ["stats", "rank", "activeTime", "favoriteModel", "persona"] as const;
      const VALID_MOOD = ["energetic", "calm", "wild", "mysterious"] as const;
      const VALID_GRID_ACCENT = ["tools", "activity", "sessions", "latency"] as const;
      const VALID_CHIPS_HIGHLIGHT = ["ide", "delta", "none"] as const;
      const VALID_PERSONA_TONE = ["playful", "humble", "confident"] as const;
      const VALID_COMMUNITY_FOCUS = ["request", "token"] as const;
      const lh = parsed.layoutHints || {};
      const hero = VALID_HERO.includes(lh.hero) ? lh.hero : "stats";
      const mood = VALID_MOOD.includes(lh.mood) ? lh.mood : "energetic";
      const hiddenSections = Array.isArray(lh.hiddenSections)
        ? lh.hiddenSections.filter((x: any) => typeof x === "string").slice(0, 8)
        : undefined;
      const gridAccent = (VALID_GRID_ACCENT as readonly string[]).includes(lh.gridAccent) ? lh.gridAccent : "tools";
      const chipsHighlight = (VALID_CHIPS_HIGHLIGHT as readonly string[]).includes(lh.chipsHighlight) ? lh.chipsHighlight : "ide";
      const personaTone = (VALID_PERSONA_TONE as readonly string[]).includes(lh.personaTone) ? lh.personaTone : "humble";
      const communityFocus = (VALID_COMMUNITY_FOCUS as readonly string[]).includes(lh.communityFocus) ? lh.communityFocus : "request";
      const layoutHints = { hero, mood, hiddenSections, gridAccent, chipsHighlight, personaTone, communityFocus };

      return {
        ok: true,
        narrative: {
          persona: {
            title: typeof parsed.persona?.title === "string" ? sanitizeText(String(parsed.persona.title)).slice(0, 60) : fallback.persona.title,
            subtitle: typeof parsed.persona?.subtitle === "string" ? sanitizeText(String(parsed.persona.subtitle)).slice(0, 120) : fallback.persona.subtitle,
          },
          sections,
          closing: typeof parsed.closing === "string" ? sanitizeText(String(parsed.closing)).slice(0, 200) : fallback.closing,
          assetChoices,
          badges: validateBadges(parsed.badges, fallback.badges),
          layoutHints,
        },
      };
    } catch {
      await backoff(attempt);
    }
  }
  return { ok: false, narrative: fallback };
}

/** Small incremental backoff between retry attempts (capped). */
function backoff(attempt: number): Promise<void> {
  const ms = Math.min(3000, 300 * (attempt + 1));
  return new Promise((r) => setTimeout(r, ms));
}

