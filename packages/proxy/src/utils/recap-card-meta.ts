/**
 * Card meta (live anime wallpaper + nested tile plan) for the shareable recap
 * card. Selected server-side at generate time so the page renders consistently
 * without re-running network calls per visitor. The renderer swaps wallpaper
 * URLs + applies overlay themes client-side.
 */
import { findLiveGif } from "./recap-gif-search.js";
import { memeForCategory, assetUrl } from "./recap-assets.js";
import { type GifCategory } from "./recap-gifs.js";

export type CardTileSize = "hero" | "sm" | "wide" | "quote";

export interface CardTile {
  key: string;
  icon: string;
  label: string;
  value: string;
  sub?: string;
  size: CardTileSize;
}

export interface CardBadge {
  icon: string;
  title: string;
}

export interface CardMeta {
  wallpaper: string | null;
  wallpapers: string[];
  defaultThemeId: number;
  tiles: CardTile[];
  quote: string;
  badge: CardBadge | null;
}

/** Stable per-user seed for theme + tile ordering variation. */
function seedFromStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function pick<T>(arr: T[], seed: number, offset = 0): T {
  return arr[(seed + offset) % arr.length];
}

function fmtNum(n: number): string {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

/** Persona-matched anime wallpaper query lists. */
function wallpaperQueries(stats: any): string[][] {
  const ratio = stats?.totals?.ioRatio ?? 0.3;
  const rank = stats?.rank?.requests || 0;
  const hr = stats?.activity?.mostActiveHour?.hour ?? 12;
  const isNight = hr < 5 || hr >= 22;

  const lists: string[][] = [];

  // Always offer a neutral beautiful default first.
  lists.push([
    "anime aesthetic loop wallpaper",
    "lofi anime scenery",
    "anime dreamy landscape loop",
    "anime city night rain loop",
  ]);

  // Time-of-day flavors.
  if (isNight) {
    lists.push([
      "anime cyberpunk night city loop",
      "anime neon city loop",
      "anime starry night loop",
      "anime moon city loop",
    ]);
  } else if (hr < 11) {
    lists.push([
      "anime sunrise loop",
      "anime cherry blossom morning loop",
      "anime clouds loop",
    ]);
  } else if (hr < 18) {
    lists.push([
      "anime sky clouds loop",
      "anime summer day loop",
      "anime rooftop loop",
    ]);
  } else {
    lists.push([
      "anime sunset loop",
      "anime twilight loop",
      "anime evening aesthetic loop",
    ]);
  }

  // Rank tier.
  if (rank === 1) {
    lists.push([
      "anime victory celebration loop",
      "anime golden aura loop",
      "anime champion glow",
      "anime fireworks loop",
    ]);
  } else if (rank <= 3) {
    lists.push([
      "anime podium glow loop",
      "anime shining trophy loop",
      "anime sparkle winner loop",
    ]);
  } else if (rank <= 10) {
    lists.push([
      "anime motivation loop",
      "anime determined eyes loop",
      "anime energy loop",
    ]);
  } else {
    lists.push([
      "anime determined loop",
      "anime training loop",
      "anime journey loop",
    ]);
  }

  // Persona flavors.
  if (ratio < 0.15) {
    lists.push([
      "anime galaxy loop",
      "anime space loop",
      "anime magic aura loop",
      "anime unlimited power loop",
    ]);
  } else if (ratio >= 0.45) {
    lists.push([
      "anime big brain loop",
      "anime genius loop",
      "anime galaxy brain loop",
    ]);
  } else {
    lists.push([
      "anime chill loop",
      "anime cozy cafe loop",
      "anime lofi chill loop",
    ]);
  }

  return lists;
}

/** Resolve up to N distinct live anime wallpaper URLs (each from a different query set). */
async function resolveWallpapers(seedId: string, stats: any, base: string, count = 5): Promise<string[]> {
  const seed = seedFromStr(seedId);
  const lists = wallpaperQueries(stats);
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lists.length && out.length < count; i++) {
    const q = lists[i];
    let url: string | null = null;
    try { url = await findLiveGif(q, seed + i); } catch { url = null; }
    if (!url) {
      // Last-resort: local self-hosted anime-styled SVG (always live, no CORS issue).
      const local = memeForCategory("wallpaper" as GifCategory, q, seed + i);
      if (local) url = assetUrl(base, local.file);
    }
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  // If even local fallback didn't yield, synthesize a final entry by reusing first.
  if (out.length === 0) {
    out.push(""); // Renderer will fall back to CSS gradient.
  }
  return out;
}

/** Build the nested tile plan for the card. */
function buildTiles(stats: any, seed: number): CardTile[] {
  const totals = stats?.totals || {};
  const rank = stats?.rank || {};
  const activity = stats?.activity || {};
  const tools = stats?.tools || {};
  const models = Array.isArray(stats?.models) ? stats.models : [];
  const cmp = stats?.comparison || {};
  const cost = stats?.cost || {};
  const ide = stats?.ide || {};

  const out: CardTile[] = [];

  // Always: requests (hero)
  out.push({
    key: "requests",
    icon: "🚀",
    label: "Request",
    value: fmtNum(totals.requests || 0),
    sub: stats?.extras?.achievements?.[0]?.title || "Bulan ini",
    size: "hero",
  });

  // Always: rank
  out.push({
    key: "rank",
    icon: "🏆",
    label: "Peringkat",
    value: rank.requests ? "#" + rank.requests : "—",
    sub: "dari semua developer",
    size: "sm",
  });

  // Always: tokens
  out.push({
    key: "tokens",
    icon: "🪙",
    label: "Token",
    value: fmtNum(totals.totalTokens || 0),
    sub: fmtNum(totals.inputTokens || 0) + " in / " + fmtNum(totals.outputTokens || 0) + " out",
    size: "sm",
  });

  // Pick 2-3 of these based on what data is interesting.
  const candidates: CardTile[] = [];
  if (activity.longestStreak) candidates.push({
    key: "streak", icon: "🔥", label: "Streak", value: String(activity.longestStreak) + " hari",
    sub: "terpanjang", size: "sm",
  });
  if (activity.activeDays) candidates.push({
    key: "active", icon: "📅", label: "Hari aktif", value: String(activity.activeDays),
    sub: activity.favoriteWeekday ? `paling rajin: ${activity.favoriteWeekday}` : "sepanjang bulan",
    size: "sm",
  });
  if (tools.totalToolCalls) candidates.push({
    key: "tools", icon: "🛠️", label: "Tool calls", value: fmtNum(tools.totalToolCalls),
    sub: (tools.toolTurnPercent || 0) + "% turn", size: "sm",
  });
  if (ide.favorite) candidates.push({
    key: "ide", icon: "💻", label: "IDE", value: String(ide.favorite),
    sub: "tempat ngoding", size: "sm",
  });
  if (cost.totalMicro) candidates.push({
    key: "cost", icon: "💸", label: "Estimasi biaya", value: "$" + (cost.totalMicro / 1_000_000).toFixed(2),
    sub: cost.mostExpensiveModel?.model ? `termahal: ${cost.mostExpensiveModel.model}` : "bulan ini",
    size: "sm",
  });
  if (models[0]?.model) candidates.push({
    key: "favModel", icon: "🤖", label: "Model favorit", value: String(models[0].model),
    sub: fmtNum(models[0].requests) + " request", size: "wide",
  });
  if (cmp.hasPrev) candidates.push({
    key: "growth",
    icon: (cmp.requestsDeltaPercent || 0) >= 0 ? "📈" : "📉",
    label: "vs bulan lalu",
    value: ((cmp.requestsDeltaPercent || 0) >= 0 ? "+" : "") + (cmp.requestsDeltaPercent || 0) + "%",
    sub: "pertumbuhan request",
    size: "sm",
  });
  if (activity.mostActiveHour?.hour != null) candidates.push({
    key: "hour",
    icon: "⏰",
    label: "Jam favorit",
    value: String(activity.mostActiveHour.hour).padStart(2, "0") + ":00",
    sub: "paling produktif",
    size: "sm",
  });

  // Shuffle candidates by seed, then add 2.
  const order = candidates.map((_, i) => i).sort((a, b) => ((a * 7 + seed) % 13) - ((b * 11 + seed) % 13));
  for (let i = 0; i < Math.min(2, order.length); i++) {
    out.push(candidates[order[i]]);
  }

  return out.slice(0, 6);
}

/** Build the "top fun fact" string for the quote card. */
function buildQuote(stats: any, narrative: any): string {
  const facts = (stats?.extras?.funFacts || []) as string[];
  if (facts.length) return String(facts[0]);
  const sub = narrative?.persona?.subtitle;
  if (sub) return String(sub);
  return "Bulan yang produktif! Terus gas ya.";
}

/** Pick a single best badge for the chip (or null). */
function buildBadge(narrative: any, stats: any): CardBadge | null {
  const badges = (narrative?.badges && narrative.badges.length ? narrative.badges : stats?.extras?.achievements) as Array<{ icon: string; title: string; desc: string }> | undefined;
  if (!badges || !badges.length) return null;
  const b = badges[0];
  return { icon: b.icon, title: b.title };
}

/** Resolve full card meta (wallpapers + tiles + quote + badge). */
export async function resolveCardMeta(
  seedId: string,
  stats: any,
  narrative: any,
  base: string,
): Promise<CardMeta> {
  const seed = seedFromStr(seedId);
  const wallpapers = await resolveWallpapers(seedId, stats, base, 5);
  const tiles = buildTiles(stats, seed);
  const quote = buildQuote(stats, narrative);
  const badge = buildBadge(narrative, stats);
  return {
    wallpaper: wallpapers[0] || null,
    wallpapers,
    defaultThemeId: seed % 100,
    tiles,
    quote,
    badge,
  };
}
