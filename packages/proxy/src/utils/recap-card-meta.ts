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
  badgeUnique: CardBadge | null;
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

function fmtLatency(ms: number): string {
  ms = Math.round(Number(ms) || 0);
  if (ms <= 0) return "—";
  if (ms >= 1000) return (ms / 1000).toFixed(1).replace(/\.0$/, "") + "s";
  return ms + "ms";
}

function truncateModel(name: string, max = 14): string {
  const s = String(name || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** True when URL is cross-origin relative to the recap public base. */
function isExternalUrl(url: string, base: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const b = new URL(base.replace(/\/$/, "") || "https://localhost");
    const u = new URL(url);
    return u.origin !== b.origin;
  } catch {
    return false;
  }
}

/** Same-origin proxy so canvas/GIF capture can read wallpaper pixels. */
export function proxiedWallpaperUrl(url: string, base: string): string {
  if (!url) return url;
  if (!isExternalUrl(url, base)) return url;
  const clean = base.replace(/\/$/, "");
  return `${clean}/recap/image-proxy?url=${encodeURIComponent(url)}`;
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

/** Extra generic "anime wallpaper" query groups, used to expand the 100-slot picker
 *  beyond the persona-matched 5-6 sets. Each inner list is one search call that
 *  may yield multiple candidate URLs. */
const EXTRA_WALLPAPER_QUERIES: string[][] = [
  ["anime wallpaper 4k loop", "anime city wallpaper", "anime sky loop", "anime night sky loop"],
  ["anime bedroom loop", "anime classroom loop", "anime kitchen loop", "anime cafe loop"],
  ["anime beach loop", "anime ocean loop", "anime forest loop", "anime mountain loop"],
  ["anime train loop", "anime rain loop", "anime snow loop", "anime fireworks loop"],
  ["anime library loop", "anime rooftop loop", "anime street loop", "anime shrine loop"],
  ["anime magical girl loop", "anime mecha loop", "anime samurai loop", "anime idol loop"],
  ["anime school uniform loop", "anime kimono loop", "anime cyber samurai loop", "anime shrine maiden loop"],
  ["anime stars loop", "anime moon loop", "anime aurora loop", "anime cloud nine loop"],
  ["anime sunset city loop", "anime rainy city loop", "anime neon city loop", "anime kanji loop"],
  ["anime lofi girl loop", "anime lofi boy loop", "anime study loop", "anime chill loop"],
  ["anime sky sunset loop", "anime purple sky loop", "anime clouds loop", "anime heaven loop"],
  ["anime flower field loop", "anime sakura loop", "anime garden loop", "anime meadow loop"],
  ["anime underwater loop", "anime aquarium loop", "anime pool loop", "anime ocean sunset loop"],
  ["anime desert loop", "anime dune loop", "anime mirage loop", "anime oasis loop"],
  ["anime space station loop", "anime spaceship loop", "anime galaxy swirl loop", "anime comet loop"],
  ["anime dragon loop", "anime spirit loop", "anime fox spirit loop", "anime magic circle loop"],
  ["anime cat ear loop", "anime maid loop", "anime witch loop", "anime knight loop"],
  ["anime DJ loop", "anime concert loop", "anime disco loop", "anime dance loop"],
  ["anime retro loop", "anime vaporwave loop", "anime 80s anime loop", "anime 90s anime loop"],
  ["anime shounen loop", "anime slice of life loop", "anime isekai loop", "anime romcom loop"],
  ["anime rooftop stars loop", "anime window rain loop", "anime cafe night loop", "anime night drive loop"],
  ["anime aquarium jellyfish loop", "anime butterfly loop", "anime koi pond loop", "anime waterfall loop"],
  ["anime bookstore loop", "anime stage loop", "anime theater loop", "anime music room loop"],
  ["anime snow globe loop", "anime lantern loop", "anime night market loop", "anime festival loop"],
  ["anime dreamy loop", "anime aesthetic loop", "anime cinematic loop", "anime vibes loop"],
];

/** Resolve up to N distinct live anime wallpaper URLs with bounded concurrency.
 *  Each query list is searched once via findLiveGif (which validates the URL).
 *  Returns whatever could be validated within a soft budget; renderer pads the
 *  remainder by cycling if needed. */
async function resolveWallpapers(seedId: string, stats: any, base: string, count = 100): Promise<string[]> {
  const seed = seedFromStr(seedId);
  const personaLists = wallpaperQueries(stats);
  const allLists: string[][] = [...personaLists, ...EXTRA_WALLPAPER_QUERIES];

  const out: string[] = [];
  const seen = new Set<string>();
  const CONCURRENCY = 8;
  // Bail early if we already have `count` and a query returns 0 new.
  let next = 0;
  async function worker() {
    while (out.length < count && next < allLists.length) {
      const myIdx = next++;
      const q = allLists[myIdx];
      let url: string | null = null;
      try { url = await findLiveGif(q, seed + myIdx); } catch { url = null; }
      if (!url) {
        const local = memeForCategory("wallpaper" as GifCategory, q, seed + myIdx);
        if (local) url = assetUrl(base, local.file);
      }
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push(proxiedWallpaperUrl(url, base));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, allLists.length) }, () => worker()));
  // No more padding to a fixed number. The renderer renders 1:1 with whatever
  // unique URLs we found (or falls back to a single gradient if zero).
  if (out.length === 0) out.push("");
  return out;
}

/** Build the nested tile plan for the card (fixed 6-tile layout). */
function buildTiles(stats: any): CardTile[] {
  const totals = stats?.totals || {};
  const rank = stats?.rank || {};
  const models = Array.isArray(stats?.models) ? stats.models : [];
  const cmp = stats?.comparison || {};
  const latency = stats?.latency || {};
  const fav = models[0];

  const growthPct = cmp.requestsDeltaPercent || 0;
  const growthValue = cmp.hasPrev
    ? ((growthPct >= 0 ? "+" : "") + growthPct + "%")
    : "NEW";
  const growthSub = cmp.hasPrev ? "pertumbuhan request" : "bulan pertama";

  return [
    {
      key: "rank",
      icon: "🏆",
      label: "Peringkat",
      value: rank.requests ? "#" + rank.requests : "—",
      sub: "dari semua developer",
      size: "hero",
    },
    {
      key: "requests",
      icon: "🚀",
      label: "Request",
      value: fmtNum(totals.requests || 0),
      sub: "bulan ini",
      size: "sm",
    },
    {
      key: "tokens",
      icon: "🪙",
      label: "Token",
      value: fmtNum(totals.totalTokens || 0),
      sub: fmtNum(totals.inputTokens || 0) + " in / " + fmtNum(totals.outputTokens || 0) + " out",
      size: "sm",
    },
    {
      key: "growth",
      icon: cmp.hasPrev && growthPct < 0 ? "📉" : "📈",
      label: "vs bulan lalu",
      value: growthValue,
      sub: growthSub,
      size: "sm",
    },
    {
      key: "favModel",
      icon: "🤖",
      label: "Model favorit",
      value: fav?.model ? truncateModel(String(fav.model)) : "—",
      sub: fav?.requests ? fmtNum(fav.requests) + " req" : "belum ada",
      size: "sm",
    },
    {
      key: "latency",
      icon: "⏱️",
      label: "Avg respond",
      value: fmtLatency(latency.avgMs),
      sub: "request sukses",
      size: "sm",
    },
  ];
}

/** Build the "top fun fact" string for the quote card. */
function buildQuote(stats: any, narrative: any): string {
  const facts = (stats?.extras?.funFacts || []) as string[];
  if (facts.length) return String(facts[0]);
  const sub = narrative?.persona?.subtitle;
  if (sub) return String(sub);
  return "Bulan yang produktif! Terus gas ya.";
}

/** Pick primary badge (left chip). */
function buildBadge(narrative: any, stats: any): CardBadge | null {
  const badges = (narrative?.badges && narrative.badges.length ? narrative.badges : stats?.extras?.achievements) as Array<{ icon: string; title: string; desc: string }> | undefined;
  if (!badges || !badges.length) return null;
  const b = badges[0];
  return { icon: b.icon, title: b.title };
}

/** Pick unique secondary badge (right chip). */
function buildSecondaryBadge(narrative: any, stats: any, seed: number): CardBadge | null {
  const narrativeBadges = (narrative?.badges || []) as Array<{ icon: string; title: string }>;
  if (narrativeBadges.length > 1) {
    return { icon: narrativeBadges[1].icon, title: narrativeBadges[1].title };
  }
  const achievements = (stats?.extras?.achievements || []) as Array<{ icon: string; title: string }>;
  if (achievements.length > 1) {
    return { icon: achievements[1].icon, title: achievements[1].title };
  }
  const rank = stats?.rank?.requests || 0;
  const persona = narrative?.persona?.title;
  if (rank === 1) return { icon: "👑", title: "Raja Bulan Ini" };
  if (rank > 0 && rank <= 3) return { icon: "🏆", title: "Top 3 Developer" };
  if (rank > 0 && rank <= 10) return { icon: "⭐", title: "Top 10 Club" };
  if (persona) return { icon: "🎯", title: String(persona).slice(0, 24) };
  const fallbacks: CardBadge[] = [
    { icon: "🔥", title: "On Fire" },
    { icon: "💡", title: "Idea Machine" },
    { icon: "⚡", title: "Speed Demon" },
  ];
  return fallbacks[seed % fallbacks.length];
}

/** Resolve full card meta (wallpapers + tiles + quote + badge). */
export async function resolveCardMeta(
  seedId: string,
  stats: any,
  narrative: any,
  base: string,
): Promise<CardMeta> {
  const seed = seedFromStr(seedId);
  const wallpapers = await resolveWallpapers(seedId, stats, base, 40);
  const tiles = buildTiles(stats);
  const quote = buildQuote(stats, narrative);
  const badge = buildBadge(narrative, stats);
  const badgeUnique = buildSecondaryBadge(narrative, stats, seed);
  return {
    wallpaper: wallpapers[0] || null,
    wallpapers,
    defaultThemeId: seed % 100,
    tiles,
    quote,
    badge,
    badgeUnique,
  };
}
