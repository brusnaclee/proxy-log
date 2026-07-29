/**
 * Monthly Recap — HTML renderer (server-generated, responsive, animated).
 *
 * Vanilla CSS + JS only (no framework). Mobile-first + desktop friendly.
 * Story-style scroll-snap sections, count-up numbers, IntersectionObserver
 * reveals, confetti, crowns, avatars, share buttons. Respects reduced motion.
 *
 * Renders only aggregate stats (no conversation content).
 */

export interface LeaderboardRow {
  rank: number;
  discordUserId: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  value: number;
}

export interface RecapHtmlData {
  apiKeyName: string;
  displayName: string;
  avatarUrl: string | null;
  monthLabel: string;
  yearMonth: string;
  stats: any;
  narrative: any;
  resolvedAssets: Record<string, { url: string; type: string } | null>;
  leaderboard: { byRequests: LeaderboardRow[]; byTokens: LeaderboardRow[] };
  rank: { requests: number; tokens: number };
  base: string;
  pageUrl: string;
  viewerDiscordUserId: string | null;
  submitToken?: string | null;
  alreadySubmittedToday?: boolean;
  existingTestimonial?: { stars: number; body: string } | null;
  cleanPath?: string;
  /** Card meta from narrative.card (live anime wallpapers + nested tile plan). */
  cardMeta?: {
    wallpaper: string | null;
    wallpapers: string[];
    defaultThemeId: number;
    tiles: Array<{ key: string; icon: string; label: string; value: string; sub?: string; size: "hero" | "sm" | "wide" | "quote" }>;
    quote: string;
    badge: { icon: string; title: string } | null;
    badgeUnique?: { icon: string; title: string } | null;
  } | null;
}

export function escapeHtml(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline Phosphor fill icons (no CDN — safe for download/GIF capture). */
const PHOSPHOR_SVG: Record<string, string> = {
  wrench: "M226.76,69.59,135.23,162.12,109.77,211.57a16,16,0,0,1-22.62,6.1l-13.68-8.8a16,16,0,0,1-6.11-22.61l49.46-25.46,92.53-92.53a8,8,0,0,1,11.31,0l8.8,8.81A8,8,0,0,1,226.76,69.59Z",
  "calendar-dots": "M40,48H216a8,8,0,0,0,8-8V24a8,8,0,0,0-8-8H40a8,8,0,0,0-8,8V40A8,8,0,0,0,40,48Zm24-32a12,12,0,1,1-12,12A12,12,0,0,1,64,16Zm80,0a12,12,0,1,1-12,12A12,12,0,0,1,144,16Zm80,0a12,12,0,1,1-12,12A12,12,0,0,1,224,16ZM32,96H224V208a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8Zm56,56a8,8,0,0,0,8-8,8,8,0,0,0-8-8H80a8,8,0,0,0-8,8,8,8,0,0,0,8,8Zm56-8a8,8,0,0,0-8,8,8,8,0,0,0,8,8h16a8,8,0,0,0,8-8,8,8,0,0,0-8-8Zm64,0a8,8,0,0,0-8,8,8,8,0,0,0,8,8h16a8,8,0,0,0,8-8,8,8,0,0,0-8-8Z",
  flame: "M166,30.68A8,8,0,0,0,154.32,35a88,88,0,0,1-20,39.59V88a8,8,0,0,1-8,8,105.11,105.11,0,0,0-41.22,86.34,12,12,0,0,0,12,12.48h53.28a8,8,0,0,0,8-8.72,112.34,112.34,0,0,1,.4-15.22,8,8,0,0,0-3.45-6.78,88.09,88.09,0,0,1,8.45-65.66,8,8,0,0,0-1.22-8.68Z",
  "chat-circle-dots": "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.75a16,16,0,0,0,20.9,20.9l33.87-11.35A104,104,0,1,0,128,24Zm32,128a12,12,0,1,1,12-12A12,12,0,0,1,160,152Zm-64,0a12,12,0,1,1,12-12A12,12,0,0,1,96,152Zm32,0a12,12,0,1,1,12-12A12,12,0,0,1,128,152Z",
  timer: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-88a8,8,0,0,1-8,8H128a8,8,0,0,1,0-16h32A8,8,0,0,1,168,128ZM120,72V40a8,8,0,0,1,16,0V72a8,8,0,0,1-16,0Z",
  laptop: "M232,168H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16ZM208,48H48A16,16,0,0,0,32,64V160H224V64A16,16,0,0,0,208,48Z",
  "trend-up": "M240,56v64a8,8,0,0,1-16,0V83.31l-82.34,82.35a8,8,0,0,1-11.32,0L96,123.31,29.66,189.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0L136,140.69,212.69,64H168a8,8,0,0,1,0-16h64A8,8,0,0,1,240,56Z",
  robot: "M200,48H168V32a8,8,0,0,0-16,0V48H104V32a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48ZM96,144a16,16,0,1,1,16-16A16,16,0,0,1,96,144Zm64,0a16,16,0,1,1,16-16A16,16,0,0,1,160,144Zm32,48H64a8,8,0,0,1,0-16H192a8,8,0,0,1,0,16Z",
  monitor: "M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Zm-48,48a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224Z",
  "currency-dollar": "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-40a8,8,0,0,1-8,8H136v8a8,8,0,0,1-16,0V176H112a8,8,0,0,1,0-16h16V152H112a8,8,0,0,1,0-16h8V128a8,8,0,0,1,16,0v8h16a32,32,0,0,1,0,64Zm-8-16a16,16,0,0,0,0-32h-8v32Z",
  clock: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-88a8,8,0,0,1-8,8H128a8,8,0,0,1,0-16h32A8,8,0,0,1,168,128Z",
  lightning: "M215.56,123.06,144,202.92V40a8,8,0,0,0-13.3-6l-80,72a8,8,0,0,0,5.3,13.78H112l-71.56,79.86A8,8,0,0,0,48,208H208a8,8,0,0,0,7.56-10.94Z",
  turtle: "M232,120a8,8,0,0,0-8-8H200.32A96.13,96.13,0,0,0,136,32.37V24a8,8,0,0,0-16,0v8.37A96.13,96.13,0,0,0,55.68,112H32a8,8,0,0,0,0,16H55.68A96.13,96.13,0,0,0,120,223.63V232a8,8,0,0,0,16,0v-8.37A96.13,96.13,0,0,0,200.32,128H224A8,8,0,0,0,232,120ZM128,208a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,208Z",
  target: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm32-88a32,32,0,1,1-32-32A32,32,0,0,1,160,128Zm-16,0a16,16,0,1,0-16,16A16,16,0,0,0,144,128Z",
  trophy: "M232,64H208V48a16,16,0,0,0-16-16H64A16,16,0,0,0,48,48V64H24a8,8,0,0,0-8,8v16a40,40,0,0,0,40,40h8.69A80.55,80.55,0,0,0,104,191.75V200H88a8,8,0,0,0,0,16h80a8,8,0,0,0,0-16H152v-8.25A80.55,80.55,0,0,0,195.31,128H204a40,40,0,0,0,40-40V72A8,8,0,0,0,232,64Z",
  lightbulb: "M176,232H80a8,8,0,0,1,0-16h96a8,8,0,0,1,0,16Zm-8-32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,200ZM128,24a80,80,0,0,0-56.57,136.57A16,16,0,0,1,80,168v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8v-8a16,16,0,0,1,8.57-7.43A80,80,0,0,0,128,24Z",
  "chart-bar": "M224,200h-8V40a8,8,0,0,0-8-8H152a8,8,0,0,0-8,8V200H104V88a8,8,0,0,0-8-8H56a8,8,0,0,0-8,8V200H40a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16ZM168,48h32V200H168Zm-64,48h32V200H104ZM56,96H88V200H56Z",
  crown: "M240,176H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM24,160H232L192,88,144,128,128,72,112,128,64,88Z",
  confetti: "M216,56H176a8,8,0,0,0,0,16h40a8,8,0,0,0,0-16ZM56,56H16a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16ZM128,24a8,8,0,0,0-8,8v40a8,8,0,0,0,16,0V32A8,8,0,0,0,128,24ZM80,88a8,8,0,0,0-11.32,0L48,108.69,35.31,96A8,8,0,0,0,24,107.31L48.69,132,24,156.69A8,8,0,0,0,35.31,168L48,155.31,68.69,176A8,8,0,0,0,80,164.69L59.31,144,80,123.31A8,8,0,0,0,80,88Zm96,0a8,8,0,0,0,0,11.31L196.69,120,176,140.69A8,8,0,0,0,187.31,152L208,131.31,228.69,152A8,8,0,0,0,240,140.69L219.31,120,240,99.31A8,8,0,0,0,228.69,88L208,108.69,187.31,88A8,8,0,0,0,176,88Z",
  "moon-stars": "M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26.06,88,88,0,0,0,110.5,110.5A89,89,0,0,1,188.9,190.34Z",
  star: "M234.5,114.38l-45.1,39.36,13.51,58.6a16,16,0,0,1-23.84,17.34l-51.11-31-51,31a16,16,0,0,1-23.84-17.34L66.61,153.8,21.5,114.38a16,16,0,0,1,9.11-28.06l59.46-5.15,23.21-55.36a15.95,15.95,0,0,1,29.44,0h0L166,81.17l59.44,5.15a16,16,0,0,1,9.11,28.06Z",
  rocket: "M223.85,47.12a16,16,0,0,0-15-15c-37.68-2.09-64.68,8.48-80.33,31.15L97.4,88.58l-2.64-2.64a16,16,0,0,0-22.63,0L42.34,116a16,16,0,0,0,0,22.63l2.64,2.64L42.34,144a16,16,0,0,0,0,22.63l25.39,25.39a16,16,0,0,0,22.63,0l2.64-2.64,2.64,2.64a16,16,0,0,0,22.63,0l32.06-32.06a16,16,0,0,0,0-22.63l-2.64-2.64,25.39-5.39c22.67-15.65,33.24-42.65,31.15-80.33A16,16,0,0,0,223.85,47.12ZM176,136a16,16,0,1,1,16-16A16,16,0,0,1,176,136Z",
  coin: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-88a8,8,0,0,1-8,8H136v8a8,8,0,0,1-16,0V136H112a8,8,0,0,1,0-16h8V112a8,8,0,0,1,16,0v8h24A8,8,0,0,1,168,128Z",
  "arrow-down": "M208,144a8,8,0,0,1-8,8H136v56a8,8,0,0,1-16,0V152H56a8,8,0,0,1,0-16h80V80a8,8,0,0,1,16,0v56h80A8,8,0,0,1,208,144Z",
  "arrow-up": "M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z",
  ghost: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-40a12,12,0,1,0,12,12A12,12,0,0,0,120,176Zm48,0a12,12,0,1,0,12,12A12,12,0,0,0,168,176Z",
  share: "M237.66,74.34l-72-72A8,8,0,0,0,152,8V40a8,8,0,0,1-8,8H96a56.06,56.06,0,0,0-56,56v48a8,8,0,0,0,16,0V104a40,40,0,0,1,40-40h48a8,8,0,0,1,8,8v32a8,8,0,0,0,16,0V72l34.34,34.34a8,8,0,0,0,11.32-11.32Z",
  link: "M240,88.23a54.43,54.43,0,0,1-16,37L192,157.66a54.27,54.27,0,0,1-77,0,8,8,0,0,1,11.32-11.32,38.26,38.26,0,0,0,54,0l32-32a38.26,38.26,0,0,0,0-54,38.26,38.26,0,0,0-54,0,8,8,0,0,1-11.32-11.32,54.27,54.27,0,0,1,77,0l32,32A54.43,54.43,0,0,1,240,88.23Z",
  download: "M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z",
  "trend-down": "M240,56v64a8,8,0,0,1-16,0V172.69l-82.34,82.35a8,8,0,0,1-11.32,0L96,180.69,29.66,246.34a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0L136,115.31,212.69,40H168a8,8,0,0,1,0-16h64A8,8,0,0,1,240,56Z",
  "sun-horizon": "M256,56a8,8,0,0,1-8,8H216V48a16,16,0,0,0-16-16H56A16,16,0,0,0,40,48V64H8a8,8,0,0,1,0-16H40V48A32,32,0,0,1,72,16H184a32,32,0,0,1,32,32V48h32A8,8,0,0,1,256,56ZM128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,152ZM32,192H224a8,8,0,0,1,0,16H32a8,8,0,0,1,0-16Z",
  quotes: "M116,72H88A16,16,0,0,0,72,88v32a16,16,0,0,0,16,16h8v8a8,8,0,0,1-8,8H88a8,8,0,0,1-8-8V88a32,32,0,0,1,32-32h4a8,8,0,0,1,0,16Zm80,0H168a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16h8v8a8,8,0,0,1-8,8h-8a8,8,0,0,1-8-8V88a32,32,0,0,1,32-32h4a8,8,0,0,1,0,16Z",
};

function phosphor(name: string, size = 16, cls = "b2-ic-sm"): string {
  const path = PHOSPHOR_SVG[name];
  if (!path) return "";
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="${path}"/></svg>`;
}

/** Map legacy emoji to Phosphor icon names. */
const EMOJI_TO_PHOSPHOR: Record<string, string> = {
  "🛠️": "wrench", "📆": "calendar-dots", "🔥": "flame", "💬": "chat-circle-dots",
  "⏱️": "timer", "💻": "laptop", "📈": "trend-up", "📉": "trend-down", "🤖": "robot", "💸": "currency-dollar",
  "🪙": "coin", "⏰": "clock", "🗓️": "calendar-dots", "⚡": "lightning", "🐌": "turtle",
  "🏆": "trophy", "💡": "lightbulb", "📊": "chart-bar", "👑": "crown", "🎉": "confetti",
  "⭐": "star", "🚀": "rocket", "📥": "arrow-down", "📤": "arrow-up", "😶": "ghost",
  "📅": "calendar-dots", "😴": "moon-stars", "🎯": "target", "🌅": "sun-horizon", "🌄": "sun-horizon",
  "🔑": "key",
};

function iconHtml(emojiOrName: string, size = 16, cls = "b2-ic-sm"): string {
  const name = EMOJI_TO_PHOSPHOR[emojiOrName] || emojiOrName;
  const svg = phosphor(name, size, cls);
  return svg || escapeHtml(emojiOrName);
}

/** Explicit grid-area for fixed 6-tile stats mosaic. */
function tileGridArea(key: string): string {
  const areas: Record<string, string> = {
    rank: "rank",
    requests: "requests",
    tokens: "tokens",
    growth: "growth",
    favModel: "favModel",
    latency: "latency",
  };
  return areas[key] || key;
}

export interface LayoutHints {
  hero?: "stats" | "rank" | "activeTime";
  mood?: "energetic" | "calm" | "wild" | "mysterious";
  hiddenSections?: string[];
  reorderTop?: string[];
  emphasisTiles?: string[];
}

interface SlideItem { id: string; html: string; }

function applyLayoutHints(items: SlideItem[], hints: LayoutHints = {}): SlideItem[] {
  const hidden = new Set(hints.hiddenSections || []);
  let out = items.filter((it) => !hidden.has(it.id));
  const reorderTop = hints.reorderTop || [];
  if (reorderTop.length) {
    const top: SlideItem[] = [];
    const rest: SlideItem[] = [];
    const seen = new Set<string>();
    for (const id of reorderTop) {
      if (id === "intro" || id === "closing") continue; // intro/closing are pinned, skip from reorderTop
      const found = out.find((it) => it.id === id);
      if (found && !seen.has(id)) { top.push(found); seen.add(id); }
    }
    for (const it of out) {
      if (!seen.has(it.id)) rest.push(it);
    }
    out = [...top, ...rest];
  }
  // Pin intro at the start and closing at the end, regardless of any
  // reordering or hiddenSections above. This guarantees the user always sees
  // a clear opening and farewell slide.
  const intro = out.find((it) => it.id === "intro");
  const closing = out.find((it) => it.id === "closing");
  if (intro || closing) {
    const middle = out.filter((it) => it.id !== "intro" && it.id !== "closing");
    out = [
      ...(intro ? [intro] : []),
      ...middle,
      ...(closing ? [closing] : []),
    ];
  }
  const hero = hints.hero || "stats";
  return out.map((it) => {
    if (it.id !== hero) return it;
    return { ...it, html: it.html.replace('class="slide"', 'class="slide slide--hero"') };
  });
}

function fmtNum(n: number): string {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

/** Full input = prompt + cache. Matches dashboard/Discord format. */
function fmtInputBreakdown(
  billable: number | undefined | null,
  cached: number | undefined | null,
  fullInput?: number | undefined | null,
  compact = false,
): string {
  const cache = Math.max(0, Number(cached) || 0);
  const totalNum =
    fullInput != null && Number.isFinite(Number(fullInput))
      ? Math.max(0, Number(fullInput))
      : Math.max(0, Number(billable) || 0) + cache;
  const bill =
    billable != null && Number.isFinite(Number(billable))
      ? Math.max(0, Number(billable))
      : Math.max(0, totalNum - cache);
  const total = fmtNum(totalNum);
  if (cache <= 0) return total;
  if (compact) return `${total} (${fmtNum(bill)} p + ${fmtNum(cache)} c)`;
  return `${total} (${fmtNum(bill)} prompt + ${fmtNum(cache)} cache)`;
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

function topModelFromStats(stats: any): { model: string; requests: number } | null {
  const m = stats?.models;
  if (!m) return null;
  if (Array.isArray(m) && m[0]?.model) return m[0];
  if (m.top?.[0]?.model) return m.top[0];
  if (m.favorite) {
    const req = m.top?.find((x: any) => x.model === m.favorite)?.requests ?? m.top?.[0]?.requests ?? 0;
    return { model: m.favorite, requests: req };
  }
  return null;
}

const WEEKDAY_ID_FULL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function restWeekdayFromStats(s: any): string | null {
  if (s?.extras?.restWeekday) return s.extras.restWeekday;
  const perDay = s?.activity?.perDay;
  if (!Array.isArray(perDay) || !perDay.length) return null;
  const wdCount = [0, 0, 0, 0, 0, 0, 0];
  for (const d of perDay) {
    const dt = new Date(String(d.day) + "T00:00:00Z");
    if (!isNaN(dt.getTime())) wdCount[dt.getUTCDay()] += Number(d.requests) || 0;
  }
  let restIdx = -1;
  let restVal = Infinity;
  wdCount.forEach((v, i) => { if (v < restVal) { restVal = v; restIdx = i; } });
  return restIdx >= 0 ? WEEKDAY_ID_FULL[restIdx] : null;
}

/** Micro-dollars -> human dollar string (e.g. 1234567 -> "$1.23"). */
function fmtMoney(micro: number): string {
  const usd = (Number(micro) || 0) / 1_000_000;
  if (usd > 0 && usd < 0.01) return "$" + usd.toFixed(4);
  if (usd < 100) return "$" + usd.toFixed(2);
  return "$" + usd.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function safeJsonForScript(obj: any): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const RECAP_CSS = `
:root{color-scheme:dark;--bg:#0b0b14;--fg:#fff;--muted:rgba(255,255,255,.7);
--g1:#7c3aed;--g2:#ec4899;--g3:#f59e0b;--g4:#22d3ee;--card:rgba(255,255,255,.07);--line:rgba(255,255,255,.14);
--font-display:"Bricolage Grotesque",system-ui,sans-serif;
--font-body:"DM Sans",system-ui,sans-serif;
--font-label:"Space Grotesk",system-ui,sans-serif;
--slide-gap:clamp(12px,3vw,22px);--head-gap:clamp(6px,1.5vw,10px)}
body.theme-gold{--g1:#f59e0b;--g2:#f43f5e;--g4:#fbbf24}
body.theme-night{--g1:#4c1d95;--g2:#7c3aed;--g4:#6366f1;--bg:#070710}
body.theme-cyan{--g1:#06b6d4;--g2:#3b82f6;--g4:#22d3ee}
body.theme-ember{--g1:#ef4444;--g2:#f59e0b;--g4:#fb923c}
body.theme-royal{--g1:#7c3aed;--g2:#f59e0b;--g4:#a855f7}
body.theme-dawn{--g1:#f59e0b;--g2:#ec4899;--g4:#fcd34d}
body.mood-calm{--g1:#60a5fa;--g2:#a78bfa;--g3:#34d399;--g4:#fbbf24}
body.mood-wild{--g1:#f43f5e;--g2:#fbbf24;--g3:#22d3ee;--g4:#a855f7}
body.mood-mysterious{--g1:#6366f1;--g2:#1e1b4b;--g3:#312e81;--g4:#1e293b}
.slide--hero .big{font-size:clamp(56px,20vw,150px);filter:drop-shadow(0 0 30px rgba(124,58,237,.5))}
.navdots{position:fixed;right:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:7px;z-index:30}
.navdots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.25);transition:background .3s,transform .3s;cursor:pointer}
.navdots i.on{background:var(--g4);transform:scale(1.5)}
@media(max-width:520px){.navdots{right:6px;gap:6px}.navdots i{width:6px;height:6px}}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--fg);font-family:var(--font-body),system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
overflow-x:hidden}
.deck{height:100dvh;overflow-y:scroll;scroll-snap-type:y mandatory;scroll-behavior:smooth}
.slide{min-height:100dvh;scroll-snap-align:start;display:flex;flex-direction:column;align-items:center;
justify-content:center;text-align:center;padding:max(24px,6vw) 20px;position:relative;gap:var(--slide-gap);
content-visibility:auto;contain-intrinsic-size:auto 100dvh}
.slide::before{content:"";position:absolute;inset:0;z-index:-1;opacity:.5;
background:radial-gradient(900px 600px at 50% 0%,rgba(124,58,237,.35),transparent 60%),
radial-gradient(700px 500px at 100% 100%,rgba(236,72,153,.25),transparent 55%)}
.wrap{width:100%;max-width:760px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:var(--slide-gap)}
.kicker{font-family:var(--font-label),system-ui,sans-serif;font-size:clamp(12px,3.2vw,15px);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:0}
.big{font-family:var(--font-display),system-ui,sans-serif;font-size:clamp(40px,16vw,120px);font-weight:900;line-height:.95;
background:linear-gradient(120deg,var(--g4),var(--g1),var(--g2),var(--g3));-webkit-background-clip:text;
background-clip:text;color:transparent;background-size:200% 200%;animation:flow 8s ease infinite}
@keyframes flow{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
.headline{font-family:var(--font-display),system-ui,sans-serif;font-size:clamp(26px,8vw,56px);font-weight:900;line-height:1.05}
.headline+.caption{margin-top:var(--head-gap)}
.avatar+.kicker{margin-top:var(--head-gap)}
.caption{font-family:var(--font-body),system-ui,sans-serif;font-size:clamp(13px,3.8vw,18px);color:var(--muted);line-height:1.6;max-width:34ch}
.card{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:clamp(18px,5vw,34px);
backdrop-filter:blur(14px);width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.avatar{width:clamp(96px,28vw,160px);height:clamp(96px,28vw,160px);border-radius:50%;object-fit:cover;
border:4px solid rgba(255,255,255,.25);box-shadow:0 12px 40px rgba(124,58,237,.5)}
.media{width:auto;max-width:min(86%,420px);max-height:42dvh;border-radius:22px;object-fit:cover;
border:1px solid var(--line);box-shadow:0 18px 50px rgba(0,0,0,.45)}
@media(max-width:520px){.media{max-height:38dvh}.big{line-height:.92}}
.b2-num{font-family:var(--font-display),system-ui,sans-serif;font-size:clamp(34px,9vw,52px);font-weight:900;line-height:1;margin-top:6px}
.b2-num-sm{font-family:var(--font-display),system-ui,sans-serif;font-size:clamp(20px,5.5vw,28px);font-weight:900;line-height:1;margin-top:3px}
.reveal{opacity:0;transform:translateY(34px) scale(.96);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none}
.rv-left{opacity:0;transform:translateX(-60px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.rv-right{opacity:0;transform:translateX(60px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.rv-zoom{opacity:0;transform:scale(.6);transition:opacity .7s cubic-bezier(.2,1.4,.4,1),transform .7s cubic-bezier(.2,1.4,.4,1)}
.rv-tilt{opacity:0;transform:rotate(-6deg) translateY(40px) scale(.92);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.rv-left.in,.rv-right.in,.rv-zoom.in,.rv-tilt.in{opacity:1;transform:none}
.pop{opacity:0;transform:scale(.5)}
.pop.in{opacity:1;transform:scale(1);transition:opacity .6s,transform .6s cubic-bezier(.2,1.4,.4,1)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px;width:100%}
@media(max-width:520px){.row2{grid-template-columns:1fr}}
.stat{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px}
.bento{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%}
@media(max-width:520px){.bento{grid-template-columns:1fr 1fr}}
.bento2{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:74px;gap:10px;width:100%;max-width:560px}
.b2{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--card);
display:flex;flex-direction:column;justify-content:center;padding:12px 14px;text-align:left;
transition:transform .2s,box-shadow .2s}
.b2:hover{transform:translateY(-4px);box-shadow:0 12px 28px rgba(0,0,0,.35)}
.b2-anchor{grid-column:span 2;grid-row:span 2;background:linear-gradient(140deg,rgba(124,58,237,.32),rgba(236,72,153,.18),var(--card))}
.b2-wide{grid-column:span 2;flex-direction:row;align-items:center;gap:12px;background:linear-gradient(140deg,rgba(34,211,238,.2),var(--card))}
.b2-sm{background:linear-gradient(140deg,rgba(255,255,255,.06),var(--card))}
.b2-sm:nth-of-type(3n){background:linear-gradient(140deg,rgba(245,158,11,.16),var(--card))}
.b2-ic,.b2-ic-sm,.wc-tile .ti,.chip-ic,.bubble-ic,.badge-ic,.tb-ic,.qi{
  position:absolute;top:10px;right:12px;color:var(--muted);opacity:.7;pointer-events:none;line-height:1}
.b2-anchor .b2-ic{width:20px;height:20px;top:10px;right:12px}
.b2-wide .b2-ic-sm{width:18px;height:18px;top:10px;right:12px}
.b2-sm .b2-ic-sm{width:16px;height:16px;top:10px;right:10px}
.b2:hover .b2-ic,.b2:hover .b2-ic-sm{opacity:1;transform:scale(1.08)}
.b2-lbl{font-size:12px;font-weight:700;margin-top:4px}
.b2-lbl-sm{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.b2-quip{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.35}
.b2-wide-tx{display:flex;flex-direction:column}
.bento-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}
@media(max-width:520px){.bento2{grid-auto-rows:64px;gap:8px;padding-top:26px}.b2-anchor{grid-row:span 2}}
.stat .num{font-size:clamp(26px,7vw,40px);font-weight:900}
.stat .lbl{font-size:clamp(12px,3.4vw,14px);color:var(--muted);margin-top:4px}
.bars{width:100%;display:flex;flex-direction:column;gap:14px;margin-top:8px}
.bar{height:26px;border-radius:14px;background:rgba(255,255,255,.1);overflow:hidden;position:relative}
.bar>span{display:block;height:100%;width:0;border-radius:14px;transition:width 1.2s cubic-bezier(.2,.7,.2,1)}
.bar.in>span{width:var(--w)}
.bar .b-in{background:linear-gradient(90deg,var(--g4),var(--g1))}
.bar .b-out{background:linear-gradient(90deg,var(--g2),var(--g3))}
.barlbl{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:4px}
.chip{display:inline-flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);
border-radius:999px;padding:8px 16px;font-weight:700;font-size:clamp(12px,3.6vw,16px);position:relative;padding-right:36px}
.chip-ic{position:absolute;right:12px;top:50%;transform:translateY(-50%);opacity:.75}
.lb{width:100%;display:flex;flex-direction:column;gap:10px}
.lb-tabs{display:flex;gap:8px;justify-content:center;margin-bottom:6px}
.lb-tab{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:999px;
padding:9px 18px;font-weight:700;cursor:pointer;font-size:14px}
.lb-tab.active{background:linear-gradient(120deg,var(--g1),var(--g2));border-color:transparent}
.lb-item{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);
border-radius:16px;padding:10px 14px;text-align:left}
.lb-item.me{border-color:var(--g3);box-shadow:0 0 0 2px rgba(245,158,11,.4)}
.lb-rank{font-weight:900;font-size:18px;width:30px;text-align:center;flex:0 0 auto}
.lb-av{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--line);flex:0 0 auto}
.lb-name{flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
.lb-val{font-weight:800;color:var(--g3);font-size:15px}
.crown{width:24px;height:24px;flex:0 0 auto}
.btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.btn{appearance:none;border:none;cursor:pointer;border-radius:999px;padding:14px 24px;font-weight:800;
font-size:clamp(14px,4vw,17px);color:#fff;background:linear-gradient(120deg,var(--g1),var(--g2));
text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:transform .15s}
.btn:active{transform:scale(.95)}
.btn.ghost{background:var(--card);border:1px solid var(--line)}
.hint{position:fixed;left:0;right:0;bottom:14px;text-align:center;color:var(--muted);font-size:13px;
pointer-events:none;animation:bob 1.6s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0);opacity:.6}50%{transform:translateY(6px);opacity:1}}
.toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(80px);
background:#fff;color:#111;padding:12px 22px;border-radius:999px;font-weight:700;opacity:0;
transition:transform .3s,opacity .3s;z-index:50}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1}
.testi{margin-top:18px;max-width:520px;text-align:left}
.testi-title{font-size:clamp(18px,5vw,24px);font-weight:900;margin-bottom:6px}
.stars{display:flex;gap:6px;margin:14px 0;font-size:clamp(30px,9vw,44px);line-height:1;justify-content:center}
.star{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.25);transition:transform .15s,color .15s;padding:0}
.star:hover{transform:scale(1.15)}
.star.on{color:#f59e0b;text-shadow:0 0 18px rgba(245,158,11,.6)}
.testi textarea{width:100%;border-radius:14px;border:1px solid var(--line);background:rgba(0,0,0,.25);
color:#fff;padding:12px 14px;font-size:15px;font-family:inherit;resize:vertical;margin-bottom:12px}
.testi-done{display:none;margin-top:10px;color:#34d399;font-weight:700}
.bcr{margin-top:8px;position:relative}
.bcr-tabs{display:flex;gap:8px;justify-content:center;margin-bottom:12px}
.bcr-tab{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:999px;
padding:9px 18px;font-weight:700;cursor:pointer;font-size:14px}
.bcr-tab.active{background:linear-gradient(120deg,var(--g1),var(--g2));border-color:transparent}
.bcr-day{font-weight:900;font-size:clamp(16px,5vw,22px);color:var(--g3);text-align:center;margin-bottom:14px;letter-spacing:.04em}
.bcr-rows{position:relative}
.bcr-row{position:absolute;left:0;right:0;height:38px;display:grid;grid-template-columns:26px 1fr;
align-items:center;gap:8px;transition:transform .7s cubic-bezier(.45,.05,.3,1)}
.bcr-rank{font-weight:800;font-size:12px;color:var(--muted);text-align:right}
.bcr-bar{position:relative;height:32px;border-radius:10px;background:rgba(255,255,255,.08);overflow:hidden}
.bcr-fill{position:absolute;inset:0;width:0;border-radius:10px;background:linear-gradient(90deg,var(--g1),var(--g2));
transition:width .55s cubic-bezier(.3,.7,.3,1)}
.bcr-row.me .bcr-fill{background:linear-gradient(90deg,var(--g3),#ffd56b)}
.bcr-row.me .bcr-name{color:#fff;font-weight:900}
.bcr-meta{position:absolute;inset:0;display:flex;align-items:center;gap:8px;padding:0 10px;z-index:1}
.bcr-av{width:22px;height:22px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:rgba(255,255,255,.2)}
.bcr-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.92)}
.bcr-val{margin-left:auto;font-weight:800;font-size:13px;flex:0 0 auto}
.testi-done.show{display:block}
.delta-up{color:#34d399}.delta-down{color:#f87171}
.badges{display:flex;flex-direction:column;gap:10px;width:100%;max-width:520px}
.badge{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px;text-align:left}
.trophy{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%;max-width:540px}
@media(max-width:520px){.trophy{grid-template-columns:1fr 1fr}}
.trophy-badge{position:relative;overflow:hidden;background:linear-gradient(150deg,rgba(245,158,11,.18),var(--card));
border:1px solid var(--line);border-radius:18px;padding:14px 12px;text-align:center}
.tb-ic{font-size:34px;line-height:1;filter:drop-shadow(0 3px 8px rgba(0,0,0,.4))}
.tb-title{font-size:13px;font-weight:900;margin-top:6px}
.tb-desc{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.3}
.tb-shine{position:absolute;top:0;left:-60%;width:40%;height:100%;
background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);
transform:skewX(-20deg);animation:shine 3.5s ease-in-out infinite}
@keyframes shine{0%,60%{left:-60%}100%{left:140%}}
@media(prefers-reduced-motion:reduce){.tb-shine{animation:none;display:none}}
.badge-ic{font-size:30px;flex:0 0 auto}
.badge-tx{display:flex;flex-direction:column}
.badge-tx b{font-size:15px}
.badge-tx span{font-size:13px;color:var(--muted)}
.facts{display:flex;flex-direction:column;gap:10px;width:100%;max-width:520px;text-align:left}
.fact{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:15px;line-height:1.4}
.bubbles{display:flex;flex-direction:column;gap:14px;width:100%;max-width:540px}
.bubble{position:relative;display:flex;align-items:flex-start;gap:10px;max-width:88%;
background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px 16px;font-size:15px;line-height:1.45}
.bb-left{align-self:flex-start;border-bottom-left-radius:4px;background:linear-gradient(135deg,rgba(124,58,237,.2),var(--card))}
.bb-right{align-self:flex-end;border-bottom-right-radius:4px;background:linear-gradient(135deg,rgba(236,72,153,.2),var(--card))}
.bb-left::after{content:"";position:absolute;left:-6px;bottom:8px;width:14px;height:14px;background:inherit;border-left:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(45deg)}
.bb-right::after{content:"";position:absolute;right:-6px;bottom:8px;width:14px;height:14px;background:inherit;border-right:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(-45deg)}
.bubble-ic{font-size:22px;flex:0 0 auto}
.bubble-tx{flex:1}
.heat{width:100%;max-width:520px}
.heat-grid{display:flex;flex-direction:column;gap:3px}
.heat-row{display:flex;align-items:center;gap:3px}
.heat-lbl{font-size:10px;color:var(--muted);width:14px;flex:0 0 auto}
.heat-row i{flex:1;aspect-ratio:1;border-radius:2px;background:var(--g4);min-width:0}
.heat-peak{outline:2px solid #fff;outline-offset:1px;border-radius:3px!important}
.heat-foot{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.heat-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);justify-content:center}
.heat-legend i{width:12px;height:12px;border-radius:2px;background:var(--g4);display:inline-block}
.heat-peak-lbl{font-size:12px;font-weight:700;color:var(--g3);text-align:center}
.heat-axis{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--muted);padding-left:17px}

/* === V2 shareable recap card: live wallpaper + nested glass cards ======= */
.wrapcard{position:relative;width:100%;max-width:380px;aspect-ratio:1/1.55;border-radius:28px;overflow:hidden;
border:1px solid rgba(255,255,255,.28);box-shadow:0 30px 80px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.06);isolation:isolate;background:#0b0b14}
.wc-wall{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;
transform:scale(1.06);animation:wcPan 18s ease-in-out infinite alternate}
.wc-wall.paused,.wc-wall--gif{animation-play-state:paused}
.wc-wall--gif{transform:scale(1.06)}
@keyframes wcPan{0%{transform:scale(1.06) translate(0,0)}100%{transform:scale(1.12) translate(-2%,-2%)}}
.wc-fallback{position:absolute;inset:0;z-index:0;background:linear-gradient(160deg,var(--wc-a,#7c3aed),var(--wc-b,#ec4899));background-size:220% 220%;animation:wcflow 7s ease infinite}
@keyframes wcflow{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
.wc-scrim{position:absolute;inset:0;z-index:1;pointer-events:none;
background:linear-gradient(180deg,var(--wc-scrim,rgba(10,0,30,0.2)) 0%,var(--wc-scrim,rgba(10,0,30,0.2)) 30%,var(--wc-scrimEnd,rgba(10,0,30,0.85)) 100%)}
.wc-stack{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;gap:7px;padding:12px 12px 14px;color:var(--wc-text,#fff)}
/* Subtler glass — "barely there but present" */
.wc-glass{position:relative;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);
border-radius:18px;backdrop-filter:blur(20px) saturate(120%);-webkit-backdrop-filter:blur(20px) saturate(120%);
box-shadow:none;padding:10px 12px}
.wc-id{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(0,0,0,.18);border-color:rgba(255,255,255,.14)}
.wc-id .av{width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.7);flex:0 0 auto;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.wc-id .name{font-family:var(--font-display),system-ui,sans-serif;font-size:16px;font-weight:900;line-height:1.05;letter-spacing:-.01em;color:var(--wc-text,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.wc-id .persona{font-family:var(--font-label),system-ui,sans-serif;font-size:11px;font-weight:800;color:var(--wc-muted,rgba(255,255,255,.85));text-transform:uppercase;letter-spacing:.08em;margin-top:1px}
.wc-mosaic{display:grid;gap:9px;align-items:stretch}
.wc-mosaic--stats{grid-template-columns:repeat(6,1fr);
grid-template-rows:minmax(84px,auto) minmax(72px,auto) minmax(64px,auto);
grid-template-areas:
  "rank rank rank rank rank rank"
  "requests requests requests tokens tokens tokens"
  "growth growth favModel favModel latency latency"}
.wc-area-rank{grid-area:rank}
.wc-area-requests{grid-area:requests}
.wc-area-tokens{grid-area:tokens}
.wc-area-growth{grid-area:growth}
.wc-area-favModel{grid-area:favModel}
.wc-area-latency{grid-area:latency}
.wc-tile{position:relative;display:flex;flex-direction:column;justify-content:flex-start;overflow:hidden;padding:10px 12px 12px;gap:3px;min-height:72px;
background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.16);border-radius:14px;
backdrop-filter:blur(12px) saturate(110%);-webkit-backdrop-filter:blur(12px) saturate(110%)}
.wc-tile.hero{padding:12px 14px;gap:4px;min-height:0;justify-content:flex-end}
.wc-tile.sm .tv{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.wc-tile .ti{width:20px;height:20px;line-height:1;flex:0 0 auto}
.wc-tile.hero .ti{width:30px;height:30px}
.wc-tile.sm{padding-top:12px}
.wc-tile.sm .tv{font-size:clamp(17px,4.5vw,24px)}
.wc-tile.sm .tl{font-size:9px}
/* Rainbow stat numbers — solid white until webfonts ready, then gradient clip */
.wc-tile .tv{font-family:var(--font-display),system-ui,sans-serif;font-weight:900;line-height:1;font-size:clamp(20px,5.2vw,27px);
letter-spacing:-.02em;color:#fff;-webkit-text-fill-color:#fff;text-shadow:0 0 1px rgba(0,0,0,.45),0 1px 2px rgba(0,0,0,.35)}
body.fonts-ready .wc-tile .tv{color:transparent;-webkit-text-fill-color:transparent;
background:linear-gradient(90deg,#ff4d6d,#ffd93d,#6ee7b7,#22d3ee,#a78bfa,#f472b6,#ff4d6d);
background-size:300% 100%;-webkit-background-clip:text;background-clip:text;
animation:tvRainbow 6s linear infinite}
@keyframes tvRainbow{0%{background-position:0 0}100%{background-position:300% 0}}
.wc-tile.hero .tv{font-size:clamp(34px,9vw,52px)}
.wc-tile .tl{font-family:var(--font-label),system-ui,sans-serif;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--wc-muted,rgba(255,255,255,.85));margin-top:4px}
.wc-tile.hero .tl{font-size:12px;margin-top:6px}
.wc-tile .ts{font-size:10px;color:var(--wc-muted,rgba(255,255,255,.7));margin-top:2px;line-height:1.25;max-width:100%;
display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
.wc-tile .tglow{position:absolute;right:-30%;bottom:-30%;width:120px;height:120px;border-radius:50%;
background:radial-gradient(closest-side,var(--wc-a,#fff),transparent 70%);opacity:.18;pointer-events:none}
.wc-quote{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;min-height:48px;background:rgba(0,0,0,.25);border-color:rgba(255,255,255,.12);font-size:12px}
.wc-quote .qi{width:20px;height:20px;line-height:1;flex:0 0 auto;color:var(--wc-muted,rgba(255,255,255,.75));position:static;opacity:1}
.wc-quote .qx{font-family:var(--font-body),system-ui,sans-serif;font-size:12.5px;font-weight:600;line-height:1.35;color:var(--wc-text,#fff);font-style:italic}
.wc-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 11px;border-radius:999px;background:rgba(0,0,0,.3);border-color:rgba(255,255,255,.18);max-width:48%;min-width:0}
.wc-badges{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%}
.wc-badge-primary{align-self:flex-start}
.wc-badge-unique{margin-left:auto;align-self:flex-end}
.wc-badge .bi{width:18px;height:18px;line-height:1;position:static;opacity:1;color:var(--wc-muted,rgba(255,255,255,.9))}
.wc-badge .bt{font-family:var(--font-label),system-ui,sans-serif;font-size:12px;font-weight:800;letter-spacing:.02em;text-transform:uppercase}
.wc-foot{display:flex;justify-content:space-between;align-items:center;padding:10px 6px 4px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--wc-muted,rgba(255,255,255,.9))}
.wc-foot .brand{opacity:.95}
.wc-themes-wrap{width:100%;max-width:380px;margin-top:14px;display:flex;flex-direction:column;gap:8px;align-items:center}
.wc-themes{position:relative;width:100%;max-height:170px;overflow-y:auto;overflow-x:hidden;padding:4px;
display:grid;grid-template-columns:repeat(10,1fr);gap:6px;
background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:16px;
scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
.wc-themes::-webkit-scrollbar{width:6px}
.wc-themes::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:3px}
.wc-sw{width:100%;aspect-ratio:1;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:transform .15s,border-color .15s;position:relative;flex:0 0 auto;background-size:cover;background-position:center;padding:0;outline:0}
.wc-sw:hover{transform:scale(1.1)}
.wc-sw.on{border-color:#fff;transform:scale(1.18);box-shadow:0 0 0 2px rgba(0,0,0,.4)}
.wc-themes-hint{font-size:11px;color:var(--muted);text-align:center}
.wc-themes.wc-locked{opacity:.45;pointer-events:none;filter:saturate(.4)}
@media(max-width:420px){.wrapcard{aspect-ratio:1/1.65}.wc-mosaic--stats{grid-template-rows:minmax(76px,auto) minmax(68px,auto) minmax(64px,auto)}
.wc-glass,.wc-tile{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
.wc-tile{background:rgba(0,0,0,.32)!important}
.wc-mosaic{gap:7px}.wc-stack{padding:10px 10px 12px;gap:6px}.wc-foot{font-size:11px;padding:10px 4px 2px}.wc-id .av{width:38px;height:38px}.wc-tile.hero .tv{font-size:clamp(28px,7vw,42px)}.wc-tile{padding:9px 11px 11px}.wc-tile.hero .ti{width:22px;height:22px;top:8px;right:10px}.wc-tile.sm .ti{width:16px;height:16px;top:8px;right:10px}.wc-themes-wrap{flex-direction:column;align-items:stretch}.btns{flex-direction:column;width:100%;max-width:380px}}
/* Snap mode: html2canvas-compatible flat rendering for downloads. Kills
   background-clip:text and backdrop-filter so text + glass survive capture. */
body.wc-snap .wc-tile .tv{visibility:hidden!important;animation:none!important}
body.wc-snap .wc-tile .tl,body.wc-snap .wc-tile .ts,body.wc-snap .wc-tile .ti,
body.wc-snap .wc-quote .qx,body.wc-snap .wc-quote .qi,
body.wc-snap .wc-badge .bt,body.wc-snap .wc-badge .bi,
body.wc-snap .wc-id .name,body.wc-snap .wc-id .persona{color:#fff!important;
  -webkit-text-fill-color:#fff!important;background-image:none!important;
  -webkit-background-clip:initial!important;background-clip:initial!important;
  text-shadow:0 1px 2px rgba(0,0,0,.45)}
body.wc-snap .wc-tile,body.wc-snap .wc-glass,body.wc-snap .wc-quote,body.wc-snap .wc-badge{
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
body.wc-snap .wc-tile{background:rgba(0,0,0,.28)!important;border-color:rgba(255,255,255,.18)!important}
body.wc-snap .wc-quote{background:rgba(0,0,0,.32)!important}
body.wc-snap .wc-badge{background:rgba(0,0,0,.36)!important}
body.wc-snap .wc-foot{color:rgba(255,255,255,.95)!important}
body.wc-snap .wc-id{background:rgba(0,0,0,.32)!important}
body.wc-snap .wc-tile.hero{padding:12px 14px;gap:4px}
body.wc-snap .wc-tile .ts{font-size:9px;line-height:1.2;margin-top:1px;-webkit-line-clamp:2;line-clamp:2}
body.wc-snap .wc-tile.hero .ts{font-size:10px;line-height:1.2;margin-top:2px}
body.wc-snap .wc-tile .tl{margin-top:3px}
body.wc-snap .wc-tile.sm{min-height:64px;padding:8px 10px 10px}
body.wc-snap .wc-tile.sm .tv{font-size:clamp(15px,3.8vw,20px)}
body.wc-snap .wc-tile.sm .tl{font-size:8px}
body.wc-snap .wc-badges .wc-badge{max-width:46%}
@media(prefers-reduced-motion:reduce){.wc-wall,.wc-fallback{animation:none}.wc-tile .tv{animation:none}}
.confetti{position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden}
.confetti i{position:absolute;top:-20px;width:10px;height:14px;opacity:.9;animation:fall linear forwards}
@keyframes fall{to{transform:translateY(110dvh) rotate(720deg)}}
@media(prefers-reduced-motion:reduce){
.reveal,.pop{transition:none !important;opacity:1 !important;transform:none !important}
.big{animation:none}.confetti{display:none}.hint{animation:none}
.bar>span{transition:none}}

/* === Speed duo (tercepat vs terlemot) ============================== */
.speed-duo{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;width:100%;max-width:620px;align-items:stretch}
@media(max-width:520px){.speed-duo{grid-template-columns:1fr;gap:12px}.speed-mid{order:3}}
.speed-col{position:relative;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:36px 14px 16px;text-align:center;overflow:hidden}
.speed-col .speed-ic{position:absolute;top:10px;right:12px;opacity:.7}
.speed-col.speed-fast{background:linear-gradient(140deg,rgba(34,211,238,.18),var(--card))}
.speed-col.speed-slow{background:linear-gradient(140deg,rgba(236,72,153,.16),var(--card))}
.speed-lbl{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.speed-name{font-size:clamp(13px,3.6vw,15px);font-weight:800;margin-top:4px;line-height:1.25;word-break:break-all;overflow-wrap:anywhere}
.speed-ms{font-size:clamp(26px,7vw,36px);font-weight:900;line-height:1;margin-top:8px;background:linear-gradient(120deg,var(--g4),var(--g1));-webkit-background-clip:text;background-clip:text;color:transparent}
.speed-ms span{font-size:12px;font-weight:700;color:var(--muted);margin-left:4px;-webkit-text-fill-color:var(--muted)}
.media-duo{width:100%;max-width:180px;max-height:140px;object-fit:cover;border-radius:14px;margin:10px auto 0;display:block;border:1px solid var(--line)}
.speed-mid{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;min-width:120px;padding:8px 0}
.speed-spectrum{position:relative;width:120px;height:18px;border-radius:999px;background:linear-gradient(90deg,rgba(236,72,153,.5),rgba(245,158,11,.45),rgba(34,211,238,.55));border:1px solid var(--line);overflow:visible}
.speed-spectrum .speed-bar{position:absolute;inset:0;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.25),rgba(255,255,255,.05))}
.speed-needle{position:absolute;top:-4px;bottom:-4px;width:4px;border-radius:3px;background:#fff;box-shadow:0 0 12px rgba(255,255,255,.7),0 0 4px rgba(0,0,0,.6);left:50%;transform:translateX(-50%) scaleY(.4);transition:transform .4s}
.speed-needle.armed{transform:translateX(-50%) scaleY(1)}
/* Needle oscillates left↔right across the spectrum after the slide is revealed. */
.speed-needle.oscillating{left:0;animation:speedOscillate 1.8s cubic-bezier(.45,.05,.55,.95) infinite}
@keyframes speedOscillate{0%{left:0}50%{left:100%}100%{left:0}}
@media(prefers-reduced-motion:reduce){
  .speed-needle.oscillating{animation:none;left:var(--needle-final,50%)}
}
.speed-tick{position:absolute;top:-22px;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--muted)}
.speed-tick-fast{right:-2px;color:var(--g4)}
.speed-tick-slow{left:-2px;color:var(--g2)}
.speed-ratio{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:center}
`;

function crownSvg(rank: number): string {
  const colors: Record<number, string> = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };
  const color = colors[rank];
  if (!color) return "";
  return `<svg class="crown" viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7z"/></svg>`;
}

function mediaTag(asset: { url: string; type: string } | null | undefined, base: string, extraClass = "media", eager = false): string {
  if (!asset || !asset.url) return "";
  const fallback = `${base}/recap-assets/misc/default.svg`;
  const cls = `media reveal ${extraClass}`.trim();
  const loadAttr = eager ? 'loading="eager" fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';
  if (asset.type === "video") {
    return `<video class="${cls}" autoplay muted loop playsinline preload="metadata"
      onerror="this.style.display='none'"><source src="${escapeHtml(asset.url)}"></video>`;
  }
  return `<img class="${cls}" ${loadAttr} referrerpolicy="no-referrer" alt="" src="${escapeHtml(asset.url)}"
    onerror="this.onerror=null;this.src='${escapeHtml(fallback)}'">`;
}

function renderLeaderboardList(rows: LeaderboardRow[], viewerId: string | null, unit: string): string {
  if (!rows.length) return `<div class="caption">Belum ada data peringkat.</div>`;
  return rows.map((r) => {
    const me = viewerId && r.discordUserId === viewerId ? " me" : "";
    const av = r.avatarUrl
      ? `<img class="lb-av" loading="lazy" alt="" src="${escapeHtml(r.avatarUrl)}" onerror="this.style.visibility='hidden'">`
      : `<div class="lb-av" style="display:grid;place-items:center;background:rgba(255,255,255,.1)">${escapeHtml((r.discordUsername || "?").slice(0, 1).toUpperCase())}</div>`;
    return `<div class="lb-item${me}">
      <span class="lb-rank">${crownSvg(r.rank) || "#" + r.rank}</span>
      ${av}
      <span class="lb-name">${escapeHtml(r.discordUsername || "Anonim")}</span>
      <span class="lb-val">${fmtNum(r.value)} ${escapeHtml(unit)}</span>
    </div>`;
  }).join("");
}

function section(id: string, inner: string): SlideItem {
  return { id, html: `<section class="slide" data-slide="${id}"><div class="wrap">${inner}</div></section>` };
}

function chipHtml(iconName: string, text: string): string {
  return `<div class="chip reveal">${escapeHtml(text)}<span class="chip-ic">${phosphor(iconName, 14, "chip-ic")}</span></div>`;
}

function n(stats: any, path: string, def = 0): number {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), stats) ?? def;
  } catch { return def; }
}

function buildSectionItems(d: RecapHtmlData): SlideItem[] {
  const s = d.stats || {};
  const nv = d.narrative || {};
  const sec = (nv.sections || {}) as Record<string, { headline?: string; caption?: string }>;
  const A = d.resolvedAssets || {};
  const txt = (k: string, hl: string, cap: string) => ({
    headline: escapeHtml(sec[k]?.headline || hl),
    caption: escapeHtml(sec[k]?.caption || cap),
  });

  const inputTok = n(s, "totals.inputTokens");
  const billableTok = n(s, "totals.billablePromptTokens");
  const cachedTok = n(s, "totals.cachedTokens");
  const inputLabel = fmtInputBreakdown(billableTok, cachedTok, inputTok);
  const outputTok = n(s, "totals.outputTokens");
  const maxTok = Math.max(inputTok, outputTok, 1);
  const inPct = Math.round((inputTok / maxTok) * 100);
  const outPct = Math.round((outputTok / maxTok) * 100);

  // ── Section builders ────────────────────────────────────────────────────
  // Each builder returns a SlideItem or null. The final deck is composed by
  // pushing builders in the order below — that is the only place ordering
  // lives, so re-arranging slides is a 1-line change.
  const builders: Record<string, (() => SlideItem | null)> = {

    intro: () => {
      const introT = txt("intro", `Recap ${d.monthLabel}`, "Yuk lihat perjalanan ngoding kamu!");
      const story = (s as any).story || {};
      const chips: string[] = [];
      if (story.addon?.name) chips.push(chipHtml("star", `Pack: ${story.addon.name}`));
      else if (story.isTrial) chips.push(chipHtml("rocket", "Explorer Trial"));
      if (story.communityTwin) chips.push(chipHtml("confetti", "Community Twin"));
      return section("intro", `
        ${d.avatarUrl ? `<img class="avatar pop" src="${escapeHtml(d.avatarUrl)}" alt="" onerror="this.style.display='none'">` : ""}
        <div class="kicker reveal">Monthly Recap</div>
        <div class="big reveal">${escapeHtml(d.monthLabel)}</div>
        <div class="headline reveal">${escapeHtml(d.displayName)}</div>
        ${chips.join("")}
        <div class="caption reveal">${introT.caption}</div>
        ${mediaTag(A.intro, d.base, "media", true)}
        <div class="hint">Scroll / geser ke bawah ⤵</div>`);
    },

    persona: () => {
      const personaTitle = nv.persona?.title || "Coder";
      const personaSub = nv.persona?.subtitle || "";
      return section("persona", `
        <div class="kicker reveal">Tipe Kamu</div>
        <div class="big reveal">${escapeHtml(personaTitle)}</div>
        <div class="caption reveal">${escapeHtml(personaSub)}</div>
        ${mediaTag(A.persona, d.base, "media", true)}`);
    },

    favoriteModel: () => {
      const favT = txt("favoriteModel", escapeHtml(n2(s, "models.favorite") || "-"), "Model andalan kamu.");
      return section("favoriteModel", `
        <div class="kicker reveal">Model Favorit</div>
        <div class="headline reveal">${favT.headline}</div>
        ${chipHtml("star", escapeHtml(n2(s, "models.favorite") || "-"))}
        <div class="caption reveal">${favT.caption}</div>
        ${mediaTag(A.favoriteModel, d.base)}`);
    },

    leastModel: () => {
      const least = (s.models?.leastUsed || [])[0];
      if (!least) return null;
      const leastT = txt("leastModel", escapeHtml(least.model), `Cuma ${least.requests || 0}x dipanggil. Kita kan teman? 🥲`);
      return section("leastModel", `
        <div class="kicker reveal">Yang Terlupakan</div>
        <div class="headline reveal">${leastT.headline}</div>
        ${chipHtml("ghost", `${escapeHtml(least.model)} · ${fmtNum(least.requests || 0)}x`)}
        <div class="caption reveal">${leastT.caption}</div>
        ${mediaTag(A.leastModel, d.base)}`);
    },

    modelSpeed: () => {
      const fastest = s.models?.fastest;
      const slowest = s.models?.slowest;
      if (fastest && fastest.model && slowest && slowest.model && slowest.model !== fastest.model) {
        const slowMs = slowest.avgLatencyMs || 0;
        const fastMs = fastest.avgLatencyMs || 0;
        const range = Math.max(slowMs - fastMs, 1);
        const slowPct = 100 - Math.round(((slowMs - fastMs) / range) * 0);
        const fastPct = 100;
        const needlePct = slowMs > fastMs
          ? Math.max(2, Math.min(98, Math.round(((slowMs - fastMs) > 0 ? 0 : 100))
            + Math.round((fastMs / Math.max(slowMs, 1)) * 96) - 4))
          : 50;
        return section("modelSpeed", `
          <div class="kicker reveal">Kecepatan Model</div>
          <div class="headline reveal">Dari Ngebut sampai Mikir Keras</div>
          <div class="speed-duo reveal">
            <div class="speed-col speed-slow" data-speed-side="slow">
              <div class="speed-ic">${phosphor("turtle", 18, "chip-ic")}</div>
              <div class="speed-lbl">Terlemot</div>
              <div class="speed-name">${escapeHtml(slowest.model)}</div>
              <div class="speed-ms">${fmtNum(slowMs)}<span>ms</span></div>
              ${mediaTag(A.slowestModel, d.base, "media-duo")}
            </div>
            <div class="speed-mid">
              <div class="speed-spectrum" id="speedSpectrum"
                data-fast="${fastPct}" data-slow="${slowPct}" data-needle="${needlePct}">
                <div class="speed-bar"></div>
                <div class="speed-needle" id="speedNeedle"></div>
                <div class="speed-tick speed-tick-fast">${phosphor("lightning", 14)}</div>
                <div class="speed-tick speed-tick-slow">${phosphor("moon-stars", 14)}</div>
              </div>
              <div class="speed-ratio">${slowMs && fastMs ? `${(slowMs / Math.max(fastMs, 1)).toFixed(1)}x lebih lambat` : ""}</div>
            </div>
            <div class="speed-col speed-fast" data-speed-side="fast">
              <div class="speed-ic">${phosphor("lightning", 18, "chip-ic")}</div>
              <div class="speed-lbl">Tercepat</div>
              <div class="speed-name">${escapeHtml(fastest.model)}</div>
              <div class="speed-ms">${fmtNum(fastMs)}<span>ms</span></div>
              ${mediaTag(A.fastestModel, d.base, "media-duo")}
            </div>
          </div>
          <div class="caption reveal">Salah satu ngebut, yang satu mikir keras dulu.</div>`);
      }
      if (fastest && fastest.model) {
        return section("modelSpeed", `
          <div class="kicker reveal">Kecepatan Model</div>
          <div class="headline reveal">${escapeHtml(fastest.model)}</div>
          ${chipHtml("lightning", `rata-rata ${fmtNum(fastest.avgLatencyMs || 0)}ms`)}
          <div class="caption reveal">Ngebut, jawab kilat tanpa drama.</div>
          ${mediaTag(A.fastestModel, d.base)}`);
      }
      if (slowest && slowest.model) {
        return section("modelSpeed", `
          <div class="kicker reveal">Kecepatan Model</div>
          <div class="headline reveal">${escapeHtml(slowest.model)}</div>
          ${chipHtml("turtle", `rata-rata ${fmtNum(slowest.avgLatencyMs || 0)}ms`)}
          <div class="caption reveal">Sabar ya, dia mikir keras dulu.</div>
          ${mediaTag(A.slowestModel, d.base)}`);
      }
      return null;
    },

    activeTime: () => {
      const hr = n(s, "activity.mostActiveHour.hour", -1);
      const actT = txt("activeTime", hr >= 0 ? `${hr}:00 WIB` : "-", "Waktu paling produktif kamu.");
      return section("activeTime", `
        <div class="kicker reveal">Jam Sibuk</div>
        <div class="big reveal">${hr >= 0 ? hr + ":00" : "-"}</div>
        ${s.activity?.favoriteWeekday ? chipHtml("calendar-dots", `Paling rajin hari ${s.activity.favoriteWeekday}`) : ""}
        ${s.extras?.restWeekday || restWeekdayFromStats(s) ? chipHtml("coffee", `Hari tersantai: ${s.extras?.restWeekday || restWeekdayFromStats(s)}`) : ""}
        ${s.activity?.mostProductiveHour ? chipHtml("lightning", `Jam paling produktif: ${n(s, "activity.mostProductiveHour.hour")}:00 WIB`) : ""}
        ${s.activity?.mostActiveDay ? chipHtml("flame", `Hari paling aktif: ${s.activity.mostActiveDay.day} (${fmtNum(n(s, "activity.mostActiveDay.requests"))} req)`) : ""}
        ${(n(s, "activity.weekendRequests") + n(s, "activity.weekdayRequests")) > 0 ? chipHtml("calendar-dots", `Weekday ${fmtNum(n(s, "activity.weekdayRequests"))} vs Weekend ${fmtNum(n(s, "activity.weekendRequests"))}`) : ""}
        <div class="caption reveal">${actT.caption}</div>
        ${mediaTag(A.activeTime, d.base)}`);
    },

    stats: () => {
      const statsT = txt("stats",
        `${fmtNum(n(s, "totals.requests"))} request · ${fmtNum(n(s, "totals.totalTokens"))} token`,
        sec.stats?.caption || sec.requests?.caption || "Total kamu mecut AI bulan ini.");
      const cost = s.cost;
      const costChips: string[] = [];
      if (cost && cost.totalMicro > 0) {
        if (cost.mostExpensiveModel) costChips.push(chipHtml("currency-dollar", `Termahal: ${cost.mostExpensiveModel.model} (${fmtMoney(cost.mostExpensiveModel.micro)})`));
        if (cost.cheapestModel) costChips.push(chipHtml("coin", `Termurah: ${cost.cheapestModel.model} (${fmtMoney(cost.cheapestModel.micro)})`));
        if (cost.mostExpensiveDay) costChips.push(chipHtml("calendar-dots", `Hari paling boros: ${cost.mostExpensiveDay.day} (${fmtMoney(cost.mostExpensiveDay.micro)})`));
        if (cost.mostExpensiveHour !== null && cost.mostExpensiveHour) costChips.push(chipHtml("clock", `Jam paling boros: ${cost.mostExpensiveHour.hour}:00 WIB (${fmtMoney(cost.mostExpensiveHour.micro)})`));
      }
      return section("stats", `
        <div class="kicker reveal">Statistik Bulan Ini</div>
        <div class="big reveal" data-count="${n(s, "totals.requests")}">0</div>
        <div class="card reveal">
          <div class="bars">
            <div><div class="barlbl"><span>${phosphor("arrow-down", 14)} Input</span><span>${inputLabel}</span></div>
              <div class="bar" style="--w:${inPct}%"><span class="b-in"></span></div></div>
            <div><div class="barlbl"><span>${phosphor("arrow-up", 14)} Output</span><span>${fmtNum(outputTok)}</span></div>
              <div class="bar" style="--w:${outPct}%"><span class="b-out"></span></div></div>
          </div>
        </div>
        ${cost && cost.totalMicro > 0 ? `<div class="big reveal">${fmtMoney(cost.totalMicro)}</div>` : ""}
        ${costChips.join("")}
        <div class="caption reveal">${statsT.caption}</div>
        ${mediaTag(A.requests || A.tokens, d.base)}`);
    },

    keys: () => {
      const count = n(s, "keys.count");
      const top = (s.keys?.top || []).filter((k: any) => (k.requests || 0) > 0);
      if (count <= 1 && top.length <= 1) return null;
      const fav = s.keys?.favorite || top[0]?.name || null;
      const rows = top.slice(0, 4).map((k: any) =>
        chipHtml("key", `${k.name}: ${fmtNum(k.requests)} req (${k.sharePercent || 0}%)`),
      ).join("");
      const multi = (s as any).story?.multiKeyLine;
      return section("keys", `
        <div class="kicker reveal">API Keys</div>
        <div class="big reveal">${fmtNum(count)}</div>
        <div class="headline reveal">key aktif di akun ini</div>
        ${fav ? chipHtml("star", `Paling sering: ${fav}`) : ""}
        ${rows}
        <div class="caption reveal">${escapeHtml(multi || "Usage digabung per Discord. Kuota & pack mengikuti aturan key/add-on kamu.")}</div>
        ${mediaTag(A.requests, d.base)}`);
    },

    identity: () => {
      const story = (s as any).story || {};
      const addon = story.addon;
      if (!addon?.name && !story.isTrial) return null;
      const lines: string[] = [];
      if (addon?.name) {
        lines.push(chipHtml("star", addon.name));
        if (addon.dailyTokenLimit > 0) lines.push(chipHtml("coin", `Pack daily ~${fmtNum(addon.dailyTokenLimit)} tok`));
        if (addon.daysLeft != null) lines.push(chipHtml("calendar-dots", `Sisa ~${addon.daysLeft} hari`));
        if (addon.description) lines.push(`<div class="caption reveal">${escapeHtml(String(addon.description).slice(0, 180))}</div>`);
      } else if (story.isTrial) {
        lines.push(chipHtml("rocket", "Explorer Trial"));
        lines.push(`<div class="caption reveal">Mode eksplor — fokus ke vibe, bukan ke limit.</div>`);
      }
      return section("identity", `
        <div class="kicker reveal">Status Akun</div>
        <div class="headline reveal">${addon?.name ? "Pack Holder" : "Trial Explorer"}</div>
        ${lines.join("")}
        ${mediaTag(A.persona, d.base)}`);
    },

    burn: () => {
      const burn = (s as any).story?.burn;
      const quota = (s as any).story?.quota;
      if (!burn?.peakPromptPerHour && !burn?.peakCallsPerHour && !quota?.line) return null;
      return section("burn", `
        <div class="kicker reveal">Peak Energy</div>
        <div class="headline reveal">Jam paling gila</div>
        ${burn?.peakPromptPerHour ? chipHtml("lightning", `Peak prompt: ${fmtNum(burn.peakPromptPerHour)}/jam${burn.peakPromptAt ? ` · ${burn.peakPromptAt}` : ""}`) : ""}
        ${burn?.peakCallsPerHour ? chipHtml("flame", `Peak traffic: ${fmtNum(burn.peakCallsPerHour)} calls/jam${burn.peakCallsAt ? ` · ${burn.peakCallsAt}` : ""}`) : ""}
        ${quota?.line ? `<div class="caption reveal">${escapeHtml(quota.line)}${quota.dailyPeakPct != null ? ` (daily peak ~${quota.dailyPeakPct}%)` : ""}</div>` : ""}
        ${mediaTag(A.requests, d.base)}`);
    },

    providers: () => {
      const p = (s as any).story?.providers;
      if (!p?.top?.length && !p?.upstream?.length) return null;
      const top = (p.top || []).slice(0, 4).map((x: any) => chipHtml("wrench", `${x.name}: ${fmtNum(x.requests)}`)).join("");
      const up = (p.upstream || []).slice(0, 4).map((x: any) => chipHtml("link", `upstream ${x.name}: ${fmtNum(x.requests)}`)).join("");
      return section("providers", `
        <div class="kicker reveal">Provider & Upstream</div>
        <div class="headline reveal">Jalur favoritmu</div>
        ${top}
        ${up}
        <div class="caption reveal">Provider = routing proxy; upstream = prefix model.</div>
        ${mediaTag(A.favoriteModel, d.base)}`);
    },

    schedule: () => {
      const sch = (s as any).story?.schedule;
      const loyalty = (s as any).story?.loyalty;
      if (!sch?.firstDay && !sch?.typicalStartHour && !loyalty) return null;
      return section("schedule", `
        <div class="kicker reveal">Jadwal Ngoding</div>
        <div class="headline reveal">${escapeHtml(sch?.warriorLine || "Rhythm kamu")}</div>
        ${sch?.favoriteWeekday ? chipHtml("calendar-dots", `Hari favorit: ${sch.favoriteWeekday}`) : ""}
        ${sch?.firstDay ? chipHtml("rocket", `First coding: ${sch.firstDay}`) : ""}
        ${sch?.lastDay ? chipHtml("trophy", `Last coding: ${sch.lastDay}`) : ""}
        ${sch?.typicalStartHour != null ? chipHtml("sun-horizon", `Biasanya start jam ${sch.typicalStartHour}:00`) : ""}
        ${sch?.typicalEndHour != null ? chipHtml("moon-stars", `Biasanya end jam ${sch.typicalEndHour}:00`) : ""}
        ${sch?.weekendSharePct != null ? chipHtml("confetti", `Weekend share ~${sch.weekendSharePct}%`) : ""}
        ${loyalty ? chipHtml("star", `Loyalty ${loyalty.streakDays}d → ${loyalty.model}`) : ""}
        ${mediaTag(A.activeTime, d.base)}`);
    },

    tokenSaver: () => {
      const ts = (s as any).story?.tokenSaver;
      if (!ts) return null;
      return section("tokenSaver", `
        <div class="kicker reveal">Token Saver</div>
        <div class="big reveal">${fmtNum(ts.estimatedSavedTokens || 0)}</div>
        <div class="headline reveal">estimasi token hemat</div>
        ${ts.bestDay ? chipHtml("coin", `Hari paling hemat: ${ts.bestDay}`) : ""}
        ${(ts.modes || []).map((m: string) => chipHtml("lightbulb", m)).join("")}
        <div class="caption reveal">${escapeHtml(ts.reason || "")}</div>
        ${mediaTag(A.tokens || A.requests, d.base)}`);
    },

    easter: () => {
      const eggs = ((s as any).story?.eggs || []).filter((e: any) => e?.title);
      if (eggs.length < 2) return null;
      // Hidden-ish slide: only when enough eggs unlocked
      return section("easter", `
        <div class="kicker reveal">Easter Eggs</div>
        <div class="headline reveal">Rahasia yang terbuka</div>
        <div class="facts reveal">
          ${eggs.slice(0, 5).map((e: any) => `<div class="fact"><strong>${escapeHtml(e.title)}</strong> — ${escapeHtml(e.desc || "")}</div>`).join("")}
        </div>
        ${(s as any).story?.fortune ? `<div class="caption reveal">🎁 ${escapeHtml((s as any).story.fortune)}</div>` : ""}
        ${mediaTag(A.ach || A.persona, d.base)}`);
    },

    ach: () => {
      const ach = (nv.badges && nv.badges.length)
        ? nv.badges
        : (s.extras?.achievements || []);
      if (!ach.length) return null;
      const achT = txt("ach", `${ach.length} Badge Kekunci 🏅`, "Bukti kamu konsisten dan eksperimental.");
      return section("ach", `
        <div class="kicker reveal">Lencana Kamu</div>
        <div class="headline reveal">${achT.headline}</div>
        <div class="trophy reveal">
          ${ach.slice(0, 4).map((b) => `<div class="trophy-badge">
            <div class="tb-shine"></div>
            <div class="tb-ic">${iconHtml(b.icon, 34, "badge-ic")}</div>
            <div class="tb-title">${escapeHtml(b.title)}</div>
            <div class="tb-desc">${escapeHtml(b.desc || "")}</div>
          </div>`).join("")}
        </div>
        <div class="caption reveal">${achT.caption}</div>
        ${mediaTag(A.ach, d.base)}`);
    },

    grid: () => section("grid", `
        <div class="kicker reveal">Angka Lain</div>
        <div class="bento2 reveal">
          ${bentoBig("wrench", fmtNum(n(s, "tools.totalToolCalls")), "Tool calls", "Agentic sejati — nyuruh AI mulu.")}
          ${bentoSm("calendar-dots", n(s, "activity.activeDays"), "Hari aktif")}
          ${bentoSm("flame", n(s, "activity.longestStreak"), "Streak")}
          ${bentoSm("chat-circle-dots", n(s, "sessions.count"), "Percakapan")}
          ${bentoSm("timer", fmtNum(n(s, "latency.avgMs")), "Latency (ms)")}
          ${bentoWide("robot", n(s, "tools.toolTurnPercent") + "%", "turn pakai tool", "Tukang suruh AI.")}
          ${bentoSm("laptop", n(s, "devices.uniqueCount"), "Device")}
        </div>
        <div class="bento-chips reveal">
          ${s.ide?.favorite ? chipHtml("laptop", `IDE favorit: ${s.ide.favorite}`) : ""}
          ${s.comparison?.hasPrev ? `<div class="chip reveal">${(s.comparison.requestsDeltaPercent || 0) >= 0 ? phosphor("trend-up", 14, "chip-ic") : phosphor("trend-down", 14, "chip-ic")}<span>${(s.comparison.requestsDeltaPercent || 0) >= 0 ? "+" : ""}${fmtNum(s.comparison.requestsDeltaPercent || 0)}% req vs bulan lalu</span></div>` : ""}
          ${s.extras?.rankUpVsPrev != null && s.extras.rankUpVsPrev !== 0 ? chipHtml("trophy", s.extras.rankUpVsPrev > 0 ? `Naik ${s.extras.rankUpVsPrev} peringkat` : `Geser ${Math.abs(s.extras.rankUpVsPrev)} peringkat`) : ""}
          ${(s as any).story?.latencyHero ? chipHtml("lightning", "Latency Hero") : ""}
        </div>
        ${mediaTag(A.requests, d.base)}`),

    facts: () => {
      const facts = ((nv.facts && nv.facts.length) ? nv.facts : (s.extras?.funFacts || [])).slice(0, 5);
      if (!facts.length) return null;
      return section("facts", `
        <div class="kicker reveal">Fakta Iseng</div>
        <div class="headline reveal">Tau Gak? 🤔</div>
        <div class="facts reveal">
          ${facts.map((f: string) => `<div class="fact">${escapeHtml(f)}</div>`).join("")}
        </div>
        ${mediaTag(A.activeTime, d.base)}`);
    },

    heatmap: () => {
      const built = buildHeatmap(s);
      if (!built) return null;
      return section("heatmap", `
        <div class="kicker reveal">Kapan Kamu Ngoding</div>
        <div class="headline reveal">Pola Jam x Hari</div>
        <div class="reveal">${built}</div>
        <div class="caption reveal">Makin gelap, makin asik kamu mikir.</div>
        ${mediaTag(A.activeTime, d.base)}`);
    },

    rest: () => {
      const rest = restWeekdayFromStats(s) || s.activity?.mostRestedWeekday;
      const quiet = s.activity?.quietestActiveDay;
      if (!rest && !quiet) return null;
      return section("rest", `
        <div class="kicker reveal">Hari Santai</div>
        <div class="headline reveal">${rest ? `${escapeHtml(rest)} Hari Tersantai` : "Hari Tersepi"}</div>
        ${rest ? chipHtml("coffee", `${rest} = hari paling jarang ngoding — wajar butuh liburan`) : ""}
        ${quiet ? chipHtml("moon-stars", `Paling sepi: ${quiet.day} (${fmtNum(n(s, "activity.quietestActiveDay.requests"))} req)`) : ""}
        ${s.activity?.firstActiveDay ? chipHtml("rocket", `Mulai aktif: ${s.activity.firstActiveDay}`) : ""}
        <div class="caption reveal">Semua orang butuh rebahan. 🌴</div>
        ${mediaTag(A.activeTime, d.base)}`);
    },

    community: () => {
      const comm = s.extras?.community;
      if (!comm || (comm.requestPercentile <= 0 && comm.tokenPercentile <= 0)) return null;
      return section("community", `
        <div class="kicker reveal">Kamu vs Komunitas</div>
        <div class="big reveal">Top ${Math.max(1, 100 - comm.requestPercentile)}%</div>
        <div class="caption reveal">Kamu lebih rajin dari <b>${comm.requestPercentile}%</b> developer Groupy${comm.tokenPercentile ? `, dan lebih boros token dari <b>${comm.tokenPercentile}%</b>` : ""}. 🚀</div>
        ${mediaTag(A.rank, d.base)}`);
    },

    rank: () => {
      const rankReq = d.rank.requests;
      const rankTok = d.rank.tokens;
      const rankT = txt("rank", rankReq ? `Peringkat #${rankReq}` : "Belum berperingkat", "");
      return section("rank", `
        <div class="kicker reveal">Peringkat Kamu</div>
        <div class="headline reveal">${rankT.headline}</div>
        <div class="row2 reveal">
          <div class="stat"><div class="num">${rankReq ? "#" + rankReq : "-"}</div><div class="lbl">Request</div></div>
          <div class="stat"><div class="num">${rankTok ? "#" + rankTok : "-"}</div><div class="lbl">Token</div></div>
        </div>
        <div class="caption reveal">${rankT.caption || (rankReq && rankReq <= 5 ? "Sultan AI! Mecut terus 🚀" : "Terus semangat ngoding!")}</div>
        ${mediaTag(A.rank, d.base)}`);
    },

    race: () => {
      const race = s.race;
      const trackReq = race?.byRequests;
      const trackTok = race?.byTokens;
      const hasReq = !!(trackReq && Array.isArray(trackReq.users) && trackReq.users.length >= 2);
      const hasTok = !!(trackTok && Array.isArray(trackTok.users) && trackTok.users.length >= 2);
      if (!race || !Array.isArray(race.days) || race.days.length < 2 || (!hasReq && !hasTok)) return null;
      const defMode = hasReq ? "requests" : "tokens";
      const myReqRank = trackReq?.myRank;
      const tabs = `
        <div class="bcr-tabs reveal">
          ${hasReq ? `<button class="bcr-tab${defMode === "requests" ? " active" : ""}" data-mode="requests">📈 By Request</button>` : ""}
          ${hasTok ? `<button class="bcr-tab${defMode === "tokens" ? " active" : ""}" data-mode="tokens">🪙 By Token</button>` : ""}
        </div>`;
      const cap = myReqRank
        ? (myReqRank <= 3 ? `Kamu finish di #${myReqRank}. Gokil! 📈` : `Kamu naik ke #${myReqRank}. Lihat perjuangannya!`)
        : "Lihat perjalanan peringkat kamu sepanjang bulan.";
      return section("race", `
        <div class="kicker reveal">Perjalanan Peringkat</div>
        <div class="headline reveal">Dari Tanggal 1 Sampai Sekarang</div>
        ${tabs}
        <div class="bcr card reveal" id="bcrBox"
          data-days='${escapeHtml(JSON.stringify(race.days))}'
          data-req='${escapeHtml(JSON.stringify(trackReq || null))}'
          data-tok='${escapeHtml(JSON.stringify(trackTok || null))}'
          data-mode='${defMode}'>
          <div class="bcr-day" id="bcrDay">&nbsp;</div>
          <div class="bcr-rows" id="bcrRows"></div>
        </div>
        <div class="caption reveal">${escapeHtml(cap)}</div>`);
    },

    leaderboard: () => section("leaderboard", `
        <div class="kicker reveal">Papan Peringkat ${escapeHtml(d.monthLabel)}</div>
        <div class="lb-tabs reveal">
          <button class="lb-tab active" data-lb="requests">📈 Request</button>
          <button class="lb-tab" data-lb="tokens">🪙 Token</button>
        </div>
        <div class="lb reveal" id="lb-requests">${renderLeaderboardList(d.leaderboard.byRequests, d.viewerDiscordUserId, "req")}</div>
        <div class="lb reveal" id="lb-tokens" style="display:none">${renderLeaderboardList(d.leaderboard.byTokens, d.viewerDiscordUserId, "tok")}</div>`),

    projection: () => {
      const proj = s.extras?.projection;
      if (!proj || proj.requests <= 0) return null;
      return section("projection", `
        <div class="kicker reveal">Ramalan Bulan Depan</div>
        <div class="headline reveal">Kalau Lanjut Segini...</div>
        <div class="row2 reveal">
          <div class="stat"><div class="num">${fmtNum(proj.requests)}</div><div class="lbl">Estimasi request</div></div>
          <div class="stat"><div class="num">${fmtNum(proj.tokens)}</div><div class="lbl">Estimasi token</div></div>
        </div>
        ${proj.costMicro > 0 ? chipHtml("currency-dollar", `Estimasi biaya: ${fmtMoney(proj.costMicro)}`) : ""}
        <div class="caption reveal">Bukan ramalan dukun, ini matematika. 🔮</div>
        ${mediaTag(A.requests, d.base)}`);
    },

    card: () => {
      const persona = nv.persona || {};
      const cmp = s.comparison || {};
      const fav = topModelFromStats(s);
      const growthPct = cmp.requestsDeltaPercent || 0;
      const fallbackTiles = [
        { key: "rank", icon: "🏆", label: "Peringkat", value: d.rank.requests ? "#" + d.rank.requests : "—", sub: "dari semua developer", size: "hero" as const },
        { key: "requests", icon: "🚀", label: "Request", value: fmtNum(n(s, "totals.requests")), sub: "bulan ini", size: "sm" as const },
        { key: "tokens", icon: "🪙", label: "Token", value: fmtNum(n(s, "totals.totalTokens")), sub: fmtInputBreakdown(n(s, "totals.billablePromptTokens"), n(s, "totals.cachedTokens"), n(s, "totals.inputTokens"), true) + " in / " + fmtNum(n(s, "totals.outputTokens")) + " out", size: "sm" as const },
        { key: "growth", icon: cmp.hasPrev && growthPct < 0 ? "📉" : "📈", label: "vs bulan lalu", value: cmp.hasPrev ? ((growthPct >= 0 ? "+" : "") + growthPct + "%") : "NEW", sub: cmp.hasPrev ? "pertumbuhan request" : "bulan pertama", size: "sm" as const },
        { key: "favModel", icon: "🤖", label: "Model favorit", value: fav?.model ? truncateModel(String(fav.model)) : "—", sub: fav?.requests ? fmtNum(fav.requests) + " req" : "belum ada", size: "sm" as const },
        { key: "latency", icon: "⏱️", label: "Avg respond", value: fmtLatency(n(s, "latency.avgMs")), sub: "request sukses", size: "sm" as const },
      ];
      const cardMetaRaw = d.cardMeta || {
        wallpaper: null,
        wallpapers: [],
        defaultThemeId: 0,
        tiles: fallbackTiles,
        quote: persona.subtitle || "Bulan yang produktif! Terus gas ya.",
        badge: (nv.badges && nv.badges[0]) ? { icon: nv.badges[0].icon, title: nv.badges[0].title } : null,
        badgeUnique: (nv.badges && nv.badges[1]) ? { icon: nv.badges[1].icon, title: nv.badges[1].title } : null,
      };
      const cardMeta = {
        ...cardMetaRaw,
        tiles: Array.isArray(cardMetaRaw.tiles) && cardMetaRaw.tiles.length ? [...cardMetaRaw.tiles] : [...fallbackTiles],
      };
      if (fav?.model) {
        const emptyFav = (v: string) => !v || v === "—" || v === "belum ada";
        cardMeta.tiles = cardMeta.tiles.map((t) => {
          if (t.key !== "favModel") return t;
          if (!emptyFav(t.value) && !emptyFav(t.sub || "")) return t;
          return {
            ...t,
            value: truncateModel(String(fav.model)),
            sub: fav.requests ? fmtNum(fav.requests) + " req" : "top model",
          };
        });
      }
      const initialWallpaper = cardMeta.wallpapers[0] || cardMeta.wallpaper || "";
      const mosaicClass = "wc-mosaic wc-mosaic--stats";
      const tilesFinal = cardMeta.tiles.map((t) => {
        const sub = t.sub ? `<div class="ts">${escapeHtml(t.sub)}</div>` : "";
        const ti = iconHtml(t.icon, t.size === "hero" ? 22 : 16, "ti");
        const area = tileGridArea(t.key);
        const areaCls = `wc-area-${area}`;
        return `<div class="wc-tile ${escapeHtml(t.size)} ${areaCls}"><div class="tglow"></div>${ti}<div class="tv">${escapeHtml(t.value)}</div><div class="tl">${escapeHtml(t.label)}</div>${sub}</div>`;
      }).join("");
      const badgeLeft = cardMeta.badge
        ? `<div class="wc-glass wc-badge wc-badge-primary">${iconHtml(cardMeta.badge.icon, 18, "bi")}<div class="bt">${escapeHtml(cardMeta.badge.title)}</div></div>`
        : "<span></span>";
      const badgeRight = cardMeta.badgeUnique
        ? `<div class="wc-glass wc-badge wc-badge-unique">${iconHtml(cardMeta.badgeUnique.icon, 18, "bi")}<div class="bt">${escapeHtml(cardMeta.badgeUnique.title)}</div></div>`
        : "";
      const badgesRow = (cardMeta.badge || cardMeta.badgeUnique)
        ? `<div class="wc-badges">${badgeLeft}${badgeRight}</div>`
        : "";
      return section("card", `
        <div class="kicker reveal">Kartu Recap Kamu</div>
        <div class="wrapcard reveal" id="wrapCard"
          data-walls='${escapeHtml(JSON.stringify(cardMeta.wallpapers))}'
          data-theme='${cardMeta.defaultThemeId || 0}'>
          <div class="wc-fallback" id="wcFallback"></div>
          <img class="wc-wall" id="wcWall" crossorigin="anonymous" alt=""
            src="${escapeHtml(initialWallpaper)}"
            onerror="this.style.display='none';document.getElementById('wcFallback').style.display='block';" />
          <div class="wc-scrim"></div>
          <div class="wc-stack">
            <div class="wc-glass wc-id">
              ${d.avatarUrl ? `<img class="av" crossorigin="anonymous" src="${escapeHtml(d.avatarUrl)}" alt="" onerror="this.style.display='none'">` : "<div class=\"av\" style=\"background:rgba(255,255,255,.2)\"></div>"}
              <div style="min-width:0;flex:1">
                <div class="name">${escapeHtml(d.displayName)}</div>
                <div class="persona">${escapeHtml(persona.title || "Coder")}</div>
              </div>
            </div>
            <div class="${mosaicClass}">${tilesFinal}</div>
            <div class="wc-glass wc-quote">
              <div class="qi">${phosphor("quotes", 18, "qi")}</div>
              <div class="qx">"${escapeHtml(cardMeta.quote)}"</div>
            </div>
            ${badgesRow}
            <div class="wc-foot">
              <span>Wrapped ${escapeHtml(d.monthLabel)}</span>
              <span class="brand">· Groupy</span>
            </div>
          </div>
        </div>
        <div class="wc-themes-wrap reveal">
          <div class="wc-themes" id="wcThemes"></div>
          <div class="wc-themes-hint">Pilih wallpaper lain — klik untuk ganti</div>
        </div>
        <div class="btns reveal">
          <button class="btn" id="dlBtn">${phosphor("download", 16)} Download Kartu (GIF)</button>
        </div>
        <div class="caption reveal" id="dlStatus">Ganti tema, klik download — nanti di-render ke GIF 📥</div>`);
    },

    closing: () => {
      const closeT = nv.closing || "Sampai jumpa bulan depan!";
      return section("closing", `
        <div class="big reveal">${phosphor("confetti", 48)}</div>
        <div class="headline reveal">${escapeHtml(closeT)}</div>
        <div class="caption reveal">Bagikan recap kamu ke teman-teman!</div>
        ${mediaTag(A.closing, d.base)}
        <div class="btns reveal">
          <button class="btn" id="shareBtn">${phosphor("share", 16)} Share</button>
          <button class="btn ghost" id="copyBtn">${phosphor("link", 16)} Salin Link</button>
          <a class="btn ghost" href="https://discord.com/channels/@me" target="_blank" rel="noopener">${phosphor("chat-circle-dots", 16)} Discord</a>
        </div>
        ${buildTestimonialBlock(d)}`);
    },
  };

  // ── Section order (storytelling arc) ────────────────────────────────────
  // 1) intro → 2) persona → 3) favoriteModel → 4) leastModel →
  // 5) modelSpeed → 6) activeTime → 7) stats (hero number) →
  // 8) ach → 9) grid → 10) facts → 11) heatmap → 12) rest →
  // 13) community → 14) rank → 15) race → 16) leaderboard →
  // 17) projection → 18) card → 19) closing
  const order: string[] = [
    "intro", "persona", "identity", "favoriteModel", "leastModel",
    "modelSpeed", "activeTime", "burn", "schedule", "stats", "providers",
    "keys", "tokenSaver", "ach",
    "grid", "facts", "heatmap", "rest", "easter",
    "community", "rank", "race", "leaderboard",
    "projection", "card", "closing",
  ];

  const out: SlideItem[] = [];
  for (const id of order) {
    const builder = builders[id];
    if (!builder) continue;
    const slide = builder();
    if (slide) out.push(slide);
  }
  return out;
}

function buildTestimonialBlock(d: RecapHtmlData): string {
  const canSubmit = !!d.submitToken;
  // No valid day-token (e.g. shared/copied clean link) -> render NOTHING.
  if (!canSubmit) return "";

  const existing = d.existingTestimonial;
  const prefillStars = existing?.stars || 0;
  const prefillBody = existing ? escapeHtml(existing.body) : "";

  // Valid token but already submitted today -> show a thank-you note (no form).
  if (d.alreadySubmittedToday && existing) {
    return `<div class="testi card reveal"><div class="testi-title">💬 Testimoni</div>
      <div class="caption">Kamu udah kasih testimoni ${"★".repeat(existing.stars)}${"☆".repeat(5 - existing.stars)} hari ini. Makasih! Balik lagi besok ya 🙌</div></div>`;
  }
  return `<div class="testi card reveal" id="testiBox">
    <div class="testi-title">💬 Tinggalkan Testimoni</div>
    <div class="caption">Gimana pengalaman ngoding kamu bulan ini? Kasih bintang & cerita singkat.</div>
    <div class="stars" id="starPick" role="radiogroup" aria-label="Rating bintang">
      ${[1, 2, 3, 4, 5].map((i) => `<button type="button" class="star" data-v="${i}" aria-label="${i} bintang">★</button>`).join("")}
    </div>
    <textarea id="testiText" maxlength="500" rows="3" placeholder="Tulis testimoni kamu di sini...">${prefillBody}</textarea>
    <button class="btn" id="testiSubmit">Kirim Testimoni</button>
    <div class="testi-done" id="testiDone">Makasih! Testimoni kamu tersimpan 🙌</div>
    <script>window.__RECAP_SUBMIT_TOKEN=${JSON.stringify(d.submitToken)};window.__RECAP_USER_ID=${JSON.stringify(d.viewerDiscordUserId || "")};window.__RECAP_YM=${JSON.stringify(d.yearMonth)};window.__RECAP_PREFILL_STARS=${prefillStars};</script>
  </div>`;
}

function n2(stats: any, path: string): string {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), stats) ?? "";
  } catch { return ""; }
}

/** Bento anchor (2x2) tile: Phosphor icon top-right, big number, label, meme quip. */
function bentoBig(iconName: string, value: string | number, label: string, quip: string): string {
  return `<div class="b2 b2-anchor">${phosphor(iconName, 20, "b2-ic")}
    <div class="b2-num">${escapeHtml(String(value))}</div>
    <div class="b2-lbl">${escapeHtml(label)}</div>
    <div class="b2-quip">${escapeHtml(quip)}</div></div>`;
}
/** Bento small (1x1) tile. */
function bentoSm(iconName: string, value: string | number, label: string): string {
  return `<div class="b2 b2-sm">${phosphor(iconName, 16, "b2-ic-sm")}
    <div class="b2-num-sm">${escapeHtml(String(value))}</div>
    <div class="b2-lbl-sm">${escapeHtml(label)}</div></div>`;
}
/** Bento wide (2x1) tile with quip. */
function bentoWide(iconName: string, value: string | number, label: string, quip: string): string {
  return `<div class="b2 b2-wide">${phosphor(iconName, 18, "b2-ic-sm")}
    <div class="b2-wide-tx"><div class="b2-num-sm">${escapeHtml(String(value))} <span class="b2-lbl-sm">${escapeHtml(label)}</span></div>
    <div class="b2-quip">${escapeHtml(quip)}</div></div></div>`;
}

function deltaChip(cmp: any): string {
  const r = cmp.requestsDeltaPercent || 0;
  const cls = r >= 0 ? "delta-up" : "delta-down";
  const arrow = r >= 0 ? "▲" : "▼";
  const tok = cmp.tokensDeltaPercent || 0;
  const tcls = tok >= 0 ? "delta-up" : "delta-down";
  const tarrow = tok >= 0 ? "▲" : "▼";
  return `📈 vs bulan lalu: <span class="${cls}">${arrow} ${Math.abs(r)}% req</span> · <span class="${tcls}">${tarrow} ${Math.abs(tok)}% token</span>`;
}

/** Build a 7x24 heatmap (weekday rows x hour cols) from perDay/perHour data. */
function buildHeatmap(s: any): string | null {
  const perDay = (s?.activity?.perDay || []) as Array<{ day: string; requests: number }>;
  const perHour = (s?.activity?.perHour || []) as Array<{ hour: number; requests: number }>;
  if (!perDay.length && !perHour.length) return null;
  const wd = [0, 0, 0, 0, 0, 0, 0];
  for (const d of perDay) {
    const dt = new Date(d.day + "T00:00:00Z");
    if (!isNaN(dt.getTime())) wd[dt.getUTCDay()] += d.requests || 0;
  }
  const hr = new Array(24).fill(0);
  for (const h of perHour) hr[h.hour] = h.requests || 0;
  const wdMax = Math.max(...wd, 1);
  const hrMax = Math.max(...hr, 1);
  const WD = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const WD_FULL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  // Find peak cell.
  let peakD = 0, peakH = 0, peakV = -1;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const v = (wd[d] / wdMax) * (hr[h] / hrMax);
    if (v > peakV) { peakV = v; peakD = d; peakH = h; }
  }
  let cells = "";
  for (let d = 0; d < 7; d++) {
    cells += `<div class="heat-row"><span class="heat-lbl">${WD[d]}</span>`;
    for (let h = 0; h < 24; h++) {
      const intensity = (wd[d] / wdMax) * (hr[h] / hrMax);
      const op = intensity > 0 ? (0.15 + intensity * 0.85).toFixed(2) : "0.05";
      const isPeak = d === peakD && h === peakH && peakV > 0;
      cells += `<i class="${isPeak ? "heat-peak" : ""}" style="opacity:${op}" title="${WD_FULL[d]} jam ${h}:00"></i>`;
    }
    cells += `</div>`;
  }
  const grid = `<div class="heat-grid">${cells}</div>
    <div class="heat-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    <div class="heat-foot">
      <div class="heat-legend">Sedikit <i style="opacity:.12"></i><i style="opacity:.35"></i><i style="opacity:.6"></i><i style="opacity:.85"></i><i style="opacity:1"></i> Banyak</div>
      ${peakV > 0 ? `<div class="heat-peak-lbl">🔥 Puncak: ${WD_FULL[peakD]} jam ${peakH}:00</div>` : ""}
    </div>`;
  return grid;
}

const RECAP_JS = `
(function(){
  // Mobile-friendly: always start at top so the intro (slide #1) is the
  // first thing the user sees, not whatever slide they last scrolled to.
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch(e) {}
  try { window.scrollTo(0, 0); } catch(e) {}
  var rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Enable gradient stat numbers only after display fonts are loaded.
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(function(){ document.body.classList.add('fonts-ready'); });
  } else {
    document.body.classList.add('fonts-ready');
  }
  // Reveal on scroll — also show first slide immediately so a JS error later
  // doesn't leave the whole deck invisible.
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); 
      if(e.target.classList.contains('bar')) {}
      countUp(e.target); io.unobserve(e.target);} });
  }, {threshold:0.25});
  document.querySelectorAll('.reveal,.pop,.bar').forEach(function(el){ io.observe(el); });
  document.querySelectorAll('.slide:first-child .reveal,.slide:first-child .pop').forEach(function(el){ el.classList.add('in'); });

  // Assign varied entrance directions per slide so it's not all centered fade.
  (function(){
    var variants=['rv-left','rv-right','rv-zoom','rv-tilt'];
    document.querySelectorAll('.slide').forEach(function(sl,si){
      if(si===0) return; // keep intro as default
      var v=variants[si % variants.length];
      sl.querySelectorAll('.reveal').forEach(function(el,ei){
        // alternate left/right within the slide for chips/cards
        var vv=v;
        if((v==='rv-left'||v==='rv-right')&&ei%2===1) vv=(v==='rv-left'?'rv-right':'rv-left');
        el.classList.remove('reveal'); el.classList.add(vv); io.observe(el);
      });
    });
  })();

  function countUp(scope){
    var nodes = scope.querySelectorAll ? scope.querySelectorAll('[data-count]') : [];
    if(scope.hasAttribute && scope.hasAttribute('data-count')) nodes=[scope];
    nodes.forEach(function(el){
      if(el.dataset.done) return; el.dataset.done='1';
      var target = parseInt(el.getAttribute('data-count'))||0;
      if(rm){ el.textContent = format(target); return; }
      var dur=1100, start=performance.now();
      function tick(t){ var p=Math.min(1,(t-start)/dur); var e=1-Math.pow(1-p,3);
        el.textContent=format(Math.round(target*e)); if(p<1) requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
    });
  }
  function format(n){ if(n>=1000000) return (n/1000000).toFixed(1).replace(/\\.0$/,'')+'M';
    if(n>=1000) return (n/1000).toFixed(1).replace(/\\.0$/,'')+'K'; return String(n); }

  // Leaderboard tabs
  document.querySelectorAll('.lb-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.lb-tab').forEach(function(t){t.classList.remove('active')});
      tab.classList.add('active');
      var k=tab.getAttribute('data-lb');
      document.getElementById('lb-requests').style.display = k==='requests'?'':'none';
      document.getElementById('lb-tokens').style.display = k==='tokens'?'':'none';
    });
  });

  // Confetti on rank/closing slide
  var deck=document.querySelector('.deck'); var fired={};
  function confetti(){ if(rm) return; var c=document.createElement('div'); c.className='confetti';
    var cols=['#7c3aed','#ec4899','#f59e0b','#22d3ee','#34d399'];
    for(var i=0;i<80;i++){var s=document.createElement('i');s.style.left=Math.random()*100+'%';
      s.style.background=cols[i%cols.length];s.style.animationDuration=(2+Math.random()*2)+'s';
      s.style.animationDelay=(Math.random()*0.5)+'s';c.appendChild(s);}
    document.body.appendChild(c); setTimeout(function(){c.remove();},4500); }
  var io2=new IntersectionObserver(function(es){es.forEach(function(e){
    if(e.isIntersecting){var id=e.target.getAttribute('data-slide');
      if((id==='closing'||id==='rank')&&!fired[id]){fired[id]=1;confetti();}}});},{threshold:0.5});
  document.querySelectorAll('.slide').forEach(function(s){io2.observe(s);});

  // Ranking race: animate cars to final position when the section enters view.
  var bcrBox=document.getElementById('bcrBox');
  if(bcrBox){
    var bcrDays=[];
    try{bcrDays=JSON.parse(bcrBox.getAttribute('data-days'))||[];}catch(e){}
    var trackReq=null, trackTok=null;
    try{trackReq=JSON.parse(bcrBox.getAttribute('data-req'));}catch(e){}
    try{trackTok=JSON.parse(bcrBox.getAttribute('data-tok'));}catch(e){}
    var rowsEl=document.getElementById('bcrRows');
    var dayEl=document.getElementById('bcrDay');
    var ROWH=44;
    var curTimer=null;
    function monthName(ds){var p=ds.split('-');var mn=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];return parseInt(p[2])+' '+mn[parseInt(p[1])-1];}
    function runBcr(mode){
      if(curTimer){clearInterval(curTimer);curTimer=null;}
      rowsEl.innerHTML='';
      var track=(mode==='tokens')?trackTok:trackReq;
      if(!track||!track.users||!track.users.length||!bcrDays.length) return;
      var users=track.users, baseRank=track.baseRank||1;
      rowsEl.style.height=(users.length*ROWH)+'px';
      var rowEls={};
      users.forEach(function(u,i){
        var row=document.createElement('div');
        row.className='bcr-row'+(u.isMe?' me':'');
        var av=u.avatar?('<img class="bcr-av" loading="lazy" src="'+u.avatar+'" onerror="this.style.visibility=\\'hidden\\'">'):'<span class="bcr-av"></span>';
        row.innerHTML='<span class="bcr-rank"></span><div class="bcr-bar"><div class="bcr-fill"></div>'+
          '<div class="bcr-meta">'+av+'<span class="bcr-name">'+(u.name?String(u.name):'Anonim')+(u.isMe?' (kamu)':'')+'</span>'+
          '<span class="bcr-val">0</span></div></div>';
        rowsEl.appendChild(row);
        rowEls[i]=row;
      });
      function render(f){
        dayEl.textContent=monthName(bcrDays[f]);
        var vals=users.map(function(u,i){return {i:i,v:(u.cumulative[f]||0)};});
        var max=Math.max.apply(null,vals.map(function(x){return x.v;}).concat([1]));
        var order=vals.slice().sort(function(a,b){return b.v-a.v;});
        order.forEach(function(x,pos){
          var row=rowEls[x.i];
          row.style.transform='translateY('+(pos*ROWH)+'px)';
          row.querySelector('.bcr-rank').textContent='#'+(baseRank+pos);
          row.querySelector('.bcr-fill').style.width=Math.max(2,Math.round((x.v/max)*100))+'%';
          row.querySelector('.bcr-val').textContent=format(x.v);
        });
      }
      render(0);
      if(rm){ render(bcrDays.length-1); return; }
      var frame=0;
      var stepMs=Math.max(450,Math.min(900,Math.round(7500/Math.max(bcrDays.length,1))));
      curTimer=setInterval(function(){
        frame++;
        if(frame>=bcrDays.length){ clearInterval(curTimer); curTimer=null; return; }
        render(frame);
      },stepMs);
    }
    // Tab switching -> re-animate from day 1.
    document.querySelectorAll('.bcr-tab').forEach(function(tab){
      tab.addEventListener('click',function(){
        document.querySelectorAll('.bcr-tab').forEach(function(t){t.classList.remove('active');});
        tab.classList.add('active');
        runBcr(tab.getAttribute('data-mode'));
      });
    });
    var bcrStarted=false;
    var io3=new IntersectionObserver(function(es){es.forEach(function(e){
      if(e.isIntersecting&&!bcrStarted){bcrStarted=true;runBcr(bcrBox.getAttribute('data-mode')||'requests');}
    });},{threshold:0.35});
    io3.observe(bcrBox);
  }

  // Kecepatan Model duo: oscillate the spectrum needle on first reveal
  var speedSlide=document.querySelector('.slide[data-slide="modelSpeed"]');
  if(speedSlide){
    var spec=document.getElementById('speedSpectrum');
    var needle=document.getElementById('speedNeedle');
    if(spec&&needle){
      var finalPct=parseFloat(spec.getAttribute('data-needle'))||50;
      needle.style.setProperty('--needle-final', finalPct+'%');
      needle.style.left=finalPct+'%';
      var speedStarted=false;
      var ioSpeed=new IntersectionObserver(function(es){
        es.forEach(function(e){
          if(e.isIntersecting&&!speedStarted){
            speedStarted=true;
            needle.classList.add('armed');
            if(rm){ return; } // respect reduced motion: stay at finalPct
            setTimeout(function(){ needle.classList.add('oscillating'); }, 250);
          }
        });
      },{threshold:0.35});
      ioSpeed.observe(speedSlide);
    }
  }

  // Share + copy
  var url=document.body.getAttribute('data-url')||location.href;
  var title=document.body.getAttribute('data-title')||'My Monthly Recap';
  function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');
    setTimeout(function(){t.classList.remove('show');},1800);}
  var sb=document.getElementById('shareBtn');
  if(sb) sb.addEventListener('click',function(){
    if(navigator.share){navigator.share({title:title,url:url}).catch(function(){});}
    else{var w='https://twitter.com/intent/tweet?text='+encodeURIComponent(title+' '+url);
      window.open(w,'_blank','noopener');}});
  var cb=document.getElementById('copyBtn');
  if(cb) cb.addEventListener('click',function(){
    if(navigator.clipboard){navigator.clipboard.writeText(url).then(function(){toast('Tersalin!');})
      .catch(function(){fallbackCopy();});} else fallbackCopy();});
  function fallbackCopy(){var i=document.createElement('input');i.value=url;document.body.appendChild(i);
    i.select();try{document.execCommand('copy');toast('Tersalin!');}catch(e){toast('Gagal menyalin');}i.remove();}

  // ── V2 Recap card: 100 hybrid themes + live wallpaper + GIF composite ────
  var THEMES=[];
  (function(){
    var families=[
      ['#fda4af','#f472b6'],['#fbcfe8','#ec4899'],['#fecdd3','#fb7185'],['#ffd6e0','#db2777'],['#f9a8d4','#be185d'],
      ['#22d3ee','#a855f7'],['#06b6d4','#7c3aed'],['#3b82f6','#ec4899'],['#0ea5e9','#8b5cf6'],['#22d3ee','#f472b6'],
      ['#a78bfa','#22d3ee'],['#fb923c','#ef4444'],['#f59e0b','#f43f5e'],['#fbbf24','#dc2626'],['#fdba74','#db2777'],
      ['#fcd34d','#c026d3'],['#22c55e','#0ea5e9'],['#10b981','#14b8a6'],['#84cc16','#22c55e'],['#34d399','#06b6d4'],
    ];
    var fams=[];
    for(var fi=0;fi<20;fi++) fams.push(families[fi%families.length]);
    for(var ti=0;ti<100;ti++){
      var p=fams[ti%20];
      THEMES.push({a:p[0],b:p[1],wall:ti%5,sat:1.05,bright:.95,
        scrim:'rgba(10,0,30,0.18)',scrimEnd:'rgba(10,0,30,0.88)',
        glass:.14,border:'rgba(255,255,255,.28)'});
    }
  })();
  var card=document.getElementById('wrapCard');
  var cardWall=document.getElementById('wcWall');
  var cardFallback=document.getElementById('wcFallback');
  var themesWrap=document.getElementById('wcThemes');
  var wallsData=[];
  try{ wallsData=JSON.parse((card&&card.getAttribute('data-walls'))||'[]')||[]; }catch(e){}
  var curTheme=Math.max(0,Math.min(99,parseInt((card&&card.getAttribute('data-theme'))||'0',10)));
  function applyTheme(i,swapWall,forcedWall){
    curTheme=((i%100)+100)%100;
    var t=THEMES[curTheme];
    if(card){
      card.style.setProperty('--wc-a',t.a);
      card.style.setProperty('--wc-b',t.b);
      card.style.setProperty('--wc-scrim',t.scrim);
      card.style.setProperty('--wc-scrimEnd',t.scrimEnd);
      card.style.setProperty('--wc-glass',String(t.glass));
      card.style.setProperty('--wc-border',t.border);
    }
    if(cardWall){
      cardWall.style.filter='saturate('+t.sat+') brightness('+t.bright+')';
      if(swapWall!==false){
        var live=wallsData.filter(Boolean);
        var w=forcedWall || (live.length ? live[curTheme % live.length] : null) || wallsData[t.wall] || wallsData[0];
        if(w){
          cardWall.style.display='';
          cardWall.src=w;
          if(/\\.gif(\\?|$)/i.test(w)) cardWall.classList.add('wc-wall--gif');
          else cardWall.classList.remove('wc-wall--gif');
          if(cardFallback) cardFallback.style.display='none';
        }
      }
    }
    if(cardFallback){
      cardFallback.style.background='linear-gradient(160deg,'+t.a+','+t.b+')';
      cardFallback.style.backgroundSize='220% 220%';
    }
    [].slice.call(themesWrap?themesWrap.children:[]).forEach(function(sw,j){sw.classList.toggle('on',j===curTheme || parseInt(sw.dataset.idx||'-1',10)===curTheme);});
  }
  if(themesWrap){
    var wallCount=Math.max(wallsData.filter(Boolean).length, wallsData.length, 1);
    // Always expose many swatches so color themes + wallpapers feel alive even
    // when only a handful of live GIFs resolved (locals pad the rest).
    var slotCount=Math.min(Math.max(wallCount, 24), 48);
    var SWATCH_LAZY_INIT=12;
    function wallAt(idx){
      var live=wallsData.filter(Boolean);
      if(live.length) return live[idx % live.length];
      return wallsData[idx % wallCount] || wallsData[0] || '';
    }
    function fillSwatchBg(sw,idx){
      if(sw.dataset.loaded) return;
      var t=THEMES[idx%THEMES.length];
      var wu=wallAt(idx);
      if(wu){
        sw.style.backgroundImage='url("'+wu+'")';
        sw.style.backgroundSize='cover';
        sw.style.backgroundPosition='center';
      } else {
        sw.style.background='linear-gradient(135deg,'+t.a+','+t.b+')';
      }
      sw.dataset.loaded='1';
      delete sw.dataset.lazy;
    }
    var swIo=('IntersectionObserver' in window)?new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.isIntersecting && e.target.dataset.lazy){
          fillSwatchBg(e.target, parseInt(e.target.dataset.idx||'0',10));
          swIo.unobserve(e.target);
        }
      });
    },{root:themesWrap,rootMargin:'48px'}):null;
    for(var k=0;k<slotCount;k++){
      (function(idx){
        var t=THEMES[idx%THEMES.length];
        var sw=document.createElement('button');
        sw.type='button';
        sw.className='wc-sw'+(idx===curTheme?' on':'');
        sw.dataset.idx=String(idx);
        if(idx<SWATCH_LAZY_INIT || idx===curTheme){
          fillSwatchBg(sw,idx);
        } else {
          sw.style.background='linear-gradient(135deg,'+t.a+','+t.b+')';
          sw.dataset.lazy='1';
          if(swIo) swIo.observe(sw);
        }
        sw.title='Wallpaper '+(idx+1);
        sw.setAttribute('aria-label','Wallpaper '+(idx+1));
        sw.addEventListener('click',function(){
          if(isDownloading){ setStatus('Tunggu render selesai sebelum ganti wallpaper ⏳'); return; }
          fillSwatchBg(sw,idx);
          applyTheme(idx, true, wallAt(idx));
        });
        themesWrap.appendChild(sw);
      })(k);
    }
    themesWrap.addEventListener('scroll',function(){
      [].slice.call(themesWrap.querySelectorAll('.wc-sw[data-lazy]')).forEach(function(sw){
        var r=sw.getBoundingClientRect(), pr=themesWrap.getBoundingClientRect();
        if(r.top<pr.bottom+64) fillSwatchBg(sw, parseInt(sw.dataset.idx||'0',10));
      });
    },{passive:true});
    applyTheme(curTheme,false);
  }
  // Pause animated wallpaper when card is off-screen (saves GPU on desktop).
  if(card && cardWall){
    if(/\\.gif(\\?|$)/i.test(cardWall.src||'')) cardWall.classList.add('wc-wall--gif');
    var wallIo=new IntersectionObserver(function(es){
      es.forEach(function(e){ cardWall.classList.toggle('paused', !e.isIntersecting); });
    },{threshold:0.08});
    wallIo.observe(card);
  }

  // Lazy-load a script once. Bounded with a 10s timeout so a hung CDN never
  // leaves the download button stuck on "Menyiapkan render...".
  var _scripts={};
  function loadScript(src){
    return new Promise(function(res,rej){
      if(_scripts[src]) return res();
      var to;
      var sc=document.createElement('script');
      sc.src=src;
      sc.onload=function(){_scripts[src]=1; clearTimeout(to); res();};
      sc.onerror=function(){ clearTimeout(to); rej(new Error('Gagal memuat '+src)); };
      to=setTimeout(function(){
        sc.onload=sc.onerror=null;
        sc.parentNode && sc.parentNode.removeChild(sc);
        rej(new Error('Timeout memuat '+src));
      }, 10000);
      document.head.appendChild(sc);
    });
  }

  // Re-draw the .wc-tile .tv stat numbers directly on the canvas with a
  // rainbow gradient. html2canvas in snap mode hides these (visibility:hidden)
  // because it can't render background-clip:text — we paint them ourselves so
  // the download matches the live preview. animOffset (0..1) shifts the
  // gradient so a GIF cycles colors per frame.
  // 7 unique colors — duplicating the first at the end here would make a
  // static PNG draw pink→pink on the long hero tile and wash everything out.
  var RAINBOW = ['#ff4d6d','#ffd93d','#6ee7b7','#22d3ee','#a78bfa','#f472b6','#fb923c'];
  var html2canvasScale = 2;

  function cacheTvRects(stackEl, scale){
    scale = scale || html2canvasScale;
    var sr = stackEl.getBoundingClientRect();
    var out = [];
    stackEl.querySelectorAll('.wc-tile').forEach(function(tile){
      var v = tile.querySelector('.tv');
      if (!v) return;
      var r = v.getBoundingClientRect();
      var fs = parseFloat(getComputedStyle(v).fontSize) * scale;
      var ff = getComputedStyle(v).fontFamily || '"Bricolage Grotesque", system-ui, sans-serif';
      var x, y, w, h;
      if (r.width > 0 && r.height > 0) {
        x = (r.left - sr.left) * scale;
        y = (r.top - sr.top) * scale;
        w = r.width * scale;
        h = r.height * scale;
      } else {
        var tr = tile.getBoundingClientRect();
        var padTop = parseFloat(getComputedStyle(tile).paddingTop) * scale;
        x = (tr.left - sr.left) * scale;
        y = (tr.top - sr.top) * scale + padTop;
        w = tr.width * scale;
        h = Math.max(fs * 1.1, 8);
      }
      out.push({ text: v.textContent || '', x: x, y: y, w: w, h: h, fs: fs, ff: ff });
    });
    return out;
  }

  function drawRainbowTileValues(ctx, cachedRects, animOffset){
    animOffset = animOffset || 0;
    if (!cachedRects || !cachedRects.length) return;
    cachedRects.forEach(function(item){
      if (!item.w || !item.h) return;
      ctx.save();
      ctx.font = '900 ' + item.fs + 'px ' + item.ff;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var grad = ctx.createLinearGradient(item.x, 0, item.x + item.w, 0);
      var N = RAINBOW.length;
      for (var cycle = 0; cycle < 2; cycle++){
        for (var i = 0; i < N; i++){
          var pos = ((cycle * N + i) / (2 * N) + animOffset) % 1;
          if (pos < 0) pos += 1;
          grad.addColorStop(pos, RAINBOW[i]);
        }
      }
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = item.fs * 0.06;
      ctx.shadowOffsetY = item.fs * 0.04;
      ctx.fillText(item.text, item.x + item.w / 2, item.y + item.h / 2);
      ctx.restore();
    });
  }

  function preloadImage(src, ms){
    ms = ms || 5000;
    return new Promise(function(res){
      if(!src){ return res(false); }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var done = false;
      var to = setTimeout(function(){ if(!done){ done=true; res(false); } }, ms);
      img.onload = function(){ if(!done){ done=true; clearTimeout(to); res(true); } };
      img.onerror = function(){ if(!done){ done=true; clearTimeout(to); res(false); } };
      img.src = src;
    });
  }

  async function preloadDownloadAssets(stackEl){
    var urls = [];
    if(cardWall && cardWall.src) urls.push(cardWall.src);
    var av = stackEl && stackEl.querySelector('.wc-id .av');
    if(av && av.src) urls.push(av.src);
    urls = urls.filter(function(u,i,a){ return u && a.indexOf(u)===i; });
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all(urls.map(function(u){ return preloadImage(u, 5000); }));
    await new Promise(function(r){ setTimeout(r, 120); });
  }

  var dlBtn=document.getElementById('dlBtn');
  var dlStatus=document.getElementById('dlStatus');
  function setStatus(m){if(dlStatus)dlStatus.textContent=m;}
  // While a download is in flight the user must wait — switching the wallpaper
  // mid-render would make the captured stack disagree with the wallpaper that
  // ends up in the file. Lock both the picker and the download button until
  // the whole pipeline (capture + GIF encode) finishes or errors out.
  var isDownloading=false;
  if(dlBtn) dlBtn.addEventListener('click',function(){
    if(isDownloading) return;
    doDownload();
  });

  async function doDownload(){
    isDownloading=true;
    dlBtn.disabled=true;
    if(themesWrap) themesWrap.classList.add('wc-locked');
    // Snap mode: html2canvas doesn't support -webkit-background-clip:text or
    // backdrop-filter. Adding .wc-snap class forces flat colors so text + glass
    // survive capture. We re-apply the previous theme after capture.
    var prevTheme=curTheme;
    try{
      setStatus('Memuat library render...');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      // Capture the glass stack (transparent). The wallpaper + scrim are
      // composited manually per-frame inside the GIF so the final file is
      // truly animated.
      var stackEl=card.querySelector('.wc-stack');
      if(!stackEl) throw new Error('Card stack not found');
      setStatus('Menyiapkan aset...');
      if(card) card.scrollIntoView({block:'center',behavior:'instant'});
      await preloadDownloadAssets(stackEl);
      setStatus('Mengambil snapshot kartu...');
      document.body.classList.add('wc-snap');
      await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});
      if(document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise(function(r){setTimeout(r,80);});
      var cachedRects = cacheTvRects(stackEl, html2canvasScale);
      var base=await Promise.race([
        window.html2canvas(stackEl,{backgroundColor:null,scale:html2canvasScale,useCORS:true,allowTaint:false,logging:false}),
        new Promise(function(_,rej){setTimeout(function(){rej(new Error('html2canvas timeout 25s'));},25000);})
      ]);
      document.body.classList.remove('wc-snap');
      // Restore the visual theme state (in case CSS variables shifted).
      applyTheme(prevTheme,false);
      if(!base || !base.width || !base.height) throw new Error('Snapshot kosong');
      setStatus('Menyusun frame GIF...');
      var gifOk=false;
      try{
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');
        await renderGif(base, cachedRects);
        gifOk=true;
      }catch(e){ gifOk=false; console.warn('GIF encode failed, falling back to PNG:', e); }
      if(!gifOk){
        // Fallback: composite wallpaper + glass as a single static PNG.
        try{
          setStatus('Menyimpan sebagai PNG...');
          var t=THEMES[curTheme];
          var w=wallsData[curTheme%wallCount]||wallsData[t.wall]||wallsData[0]||null;
          var W=base.width,H=base.height;
          var c=document.createElement('canvas');c.width=W;c.height=H;var ctx=c.getContext('2d');
          if(w){
            var img=new Image();img.crossOrigin='anonymous';
            await new Promise(function(res){img.onload=res;img.onerror=res;img.src=w;});
            if(img.naturalWidth) ctx.drawImage(img,0,0,W,H);
            else { var g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,t.a);g.addColorStop(1,t.b);ctx.fillStyle=g;ctx.fillRect(0,0,W,H); }
            var sg=ctx.createLinearGradient(0,0,0,H);sg.addColorStop(0,t.scrim);sg.addColorStop(1,t.scrimEnd);ctx.fillStyle=sg;ctx.fillRect(0,0,W,H);
          }
          ctx.drawImage(base,0,0);
          drawRainbowTileValues(ctx, cachedRects, 0);
          var a=document.createElement('a');a.href=c.toDataURL('image/png');a.download='recap-card.png';a.click();
          setStatus('Tersimpan sebagai PNG ✓');
        }catch(_){
          var a2=document.createElement('a');a2.href=base.toDataURL('image/png');a2.download='recap-card.png';a2.click();
          setStatus('Tersimpan sebagai PNG ✓');
        }
      }
    }catch(e){
      try { document.body.classList.remove('wc-snap'); } catch(_){}
      try { applyTheme(prevTheme,false); } catch(_){}
      console.error('doDownload failed:', e);
      setStatus('Gagal render: '+(e&&e.message||'error'));
    }finally{
      isDownloading=false;
      dlBtn.disabled=false;
      if(themesWrap) themesWrap.classList.remove('wc-locked');
    }
  }

  function renderGif(base, cachedRects){return new Promise(function(resolve,reject){
    if(rm){
      var a=document.createElement('a');a.href=base.toDataURL('image/png');a.download='recap-card.png';a.click();return resolve();
    }
    var W=base.width,H=base.height;
    // 15s budget for fetching the worker script. Cdnjs is fast on a normal
    // connection, but we don't want a slow network to leave the button stuck.
    var abortF=null;
    try { abortF=new AbortController(); } catch(_){}
    var fetchOpts=abortF?{signal:abortF.signal}:{};
    var workerTimer=setTimeout(function(){
      try { abortF && abortF.abort(); } catch(_){}
      reject(new Error('worker fetch timeout'));
    }, 15000);
    fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js', fetchOpts)
      .then(function(r){ if(!r.ok) throw new Error('worker '+r.status); return r.text(); })
      .then(function(code){
        clearTimeout(workerTimer);
        var workerUrl=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
        var gif=new window.GIF({workers:2,quality:10,width:W,height:H,workerScript:workerUrl});
        var t=THEMES[curTheme];
        var FRAMES=18, c=document.createElement('canvas'); c.width=W;c.height=H; var ctx=c.getContext('2d');
        // Use the wallpaper at the current swatch index (1:1 with what the user
        // sees live), not the baked-in theme default.
        var wallUrl=wallsData[curTheme%wallCount]||wallsData[t.wall]||wallsData[0]||null;
        var wallImg=wallUrl?new Image():null;
        if(wallImg) wallImg.crossOrigin='anonymous';
        var wallReady=!wallImg;
        if(wallImg){
          wallImg.onload=function(){wallReady=true;};
          wallImg.onerror=function(){wallReady=true;};
          wallImg.src=wallUrl;
        }
        // Wait for wallpaper to load (or 5s timeout) before composing frames.
        var wallWaitStart=Date.now();
        var waitWall=function(){
          if(wallReady) return Promise.resolve();
          if(Date.now()-wallWaitStart>5000) return Promise.resolve();
          return new Promise(function(r){setTimeout(function(){waitWall().then(r);},80);});
        };
        waitWall().then(function(){
          for(var f=0;f<FRAMES;f++){
            var p=f/FRAMES;
            var ang=p*Math.PI*2;
            // Wallpaper layer (with subtle Ken Burns pan).
            if(wallImg && wallImg.complete && wallImg.naturalWidth){
              var ratio=wallImg.naturalWidth/wallImg.naturalHeight;
              var drawH=H;
              var drawW=drawH*ratio;
              if(drawW<W){ drawW=W; drawH=drawW/ratio; }
              var scale=1.06+0.04*Math.sin(ang);
              var w=drawW*scale, h=drawH*scale;
              var ox=Math.sin(ang)*(W*0.02), oy=Math.cos(ang)*(H*0.02);
              ctx.drawImage(wallImg,(W-w)/2+ox,(H-h)/2+oy,w,h);
            } else {
              var g=ctx.createLinearGradient(0,0,W,H);
              g.addColorStop(0,t.a); g.addColorStop(1,t.b);
              ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
            }
            // Bottom-heavy scrim.
            var sg=ctx.createLinearGradient(0,0,0,H);
            sg.addColorStop(0,t.scrim); sg.addColorStop(1,t.scrimEnd);
            ctx.fillStyle=sg; ctx.fillRect(0,0,W,H);
            // Glass overlay (captured transparent by html2canvas).
            ctx.drawImage(base,0,0);
            // Re-draw rainbow stat numbers with a per-frame offset so the
            // gradient cycles in the GIF (matches the live tvRainbow anim).
            drawRainbowTileValues(ctx, cachedRects, f / FRAMES);
            gif.addFrame(ctx,{copy:true,delay:90});
          }
          // 45s render budget. If progress hasn't moved at all in 8s after
          // frames are added, the worker silently failed (no events fire) and
          // we should bail out to the PNG fallback.
          var stalledSince=Date.now();
          var to=setTimeout(function(){reject(new Error('gif render timeout'));},45000);
          var stallTo=setTimeout(function(){
            console.warn('GIF worker stalled, no progress in 8s, aborting to PNG');
            try { gif.abort(); } catch(_){}
            clearTimeout(to);
            reject(new Error('gif worker stalled'));
          }, 8000);
          gif.on('progress',function(pr){
            stalledSince=Date.now();
            clearTimeout(stallTo);
            stallTo=setTimeout(function(){
              console.warn('GIF worker stalled, no progress in 8s, aborting to PNG');
              try { gif.abort(); } catch(_){}
              clearTimeout(to);
              reject(new Error('gif worker stalled'));
            }, 8000);
            setStatus('Merender GIF... '+Math.round(pr*100)+'%');
          });
          gif.on('finished',function(blob){
            clearTimeout(to); clearTimeout(stallTo);
            URL.revokeObjectURL(workerUrl);
            var u=URL.createObjectURL(blob);
            var a=document.createElement('a');
            a.href=u; a.download='recap-card.gif'; a.click();
            setTimeout(function(){URL.revokeObjectURL(u);},4000);
            setStatus('Tersimpan sebagai GIF ✓');
            resolve();
          });
          gif.render();
        });
      })
      .catch(reject);
  });}

  // Strip ?t= single-use token from the URL so shared/copied links are clean.
  try{ if(location.search.indexOf('t=')!==-1 && window.__RECAP_CLEAN_PATH){
    history.replaceState(null,'',window.__RECAP_CLEAN_PATH); } }catch(e){}

  // Nav dots (one per slide) + tap-to-continue.
  try{
    var deckEl=document.querySelector('.deck');
    var slides=[].slice.call(document.querySelectorAll('.slide'));
    var dotsWrap=document.getElementById('navDots');
    if(deckEl&&slides.length&&dotsWrap){
      slides.forEach(function(sl,i){
        var dot=document.createElement('i');
        dot.addEventListener('click',function(){slides[i].scrollIntoView({behavior:'smooth'});});
        dotsWrap.appendChild(dot);
      });
      var dots=[].slice.call(dotsWrap.children);
      var dio=new IntersectionObserver(function(es){es.forEach(function(e){
        if(e.isIntersecting){var idx=slides.indexOf(e.target);dots.forEach(function(dd,j){dd.classList.toggle('on',j===idx);});}
      });},{threshold:0.6});
      slides.forEach(function(sl){dio.observe(sl);});
      // Tap-to-continue: tap right 70% of screen -> next slide (ignore taps on buttons/inputs/links).
      deckEl.addEventListener('click',function(ev){
        if(ev.target.closest('button,a,input,textarea,.star,.lb-tab,.bcr-tab,.navdots')) return;
        if(ev.clientX < window.innerWidth*0.3) return;
        var cur=-1;for(var k=0;k<slides.length;k++){var r=slides[k].getBoundingClientRect();if(r.top>=-5&&r.top<window.innerHeight*0.5){cur=k;break;}}
        if(cur>=0&&cur<slides.length-1) slides[cur+1].scrollIntoView({behavior:'smooth'});
      });
    }
  }catch(e){}

  // Testimonial form
  var starWrap=document.getElementById('starPick');
  if(starWrap){
    var picked=window.__RECAP_PREFILL_STARS||0;
    var stars=[].slice.call(starWrap.querySelectorAll('.star'));
    function paint(v){stars.forEach(function(s){s.classList.toggle('on',parseInt(s.dataset.v)<=v);});}
    paint(picked);
    stars.forEach(function(s){
      s.addEventListener('mouseenter',function(){paint(parseInt(s.dataset.v));});
      s.addEventListener('mouseleave',function(){paint(picked);});
      s.addEventListener('click',function(){picked=parseInt(s.dataset.v);paint(picked);});
    });
    var sub=document.getElementById('testiSubmit');
    sub.addEventListener('click',function(){
      if(!picked){toast('Pilih bintang dulu ya');return;}
      sub.disabled=true;sub.textContent='Mengirim...';
      fetch('/recap/testimonial',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:window.__RECAP_SUBMIT_TOKEN,userId:window.__RECAP_USER_ID,yearMonth:window.__RECAP_YM,stars:picked,body:(document.getElementById('testiText').value||'')})})
        .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
        .then(function(res){ if(res.ok&&res.j.success){
            document.getElementById('testiDone').classList.add('show');
            sub.textContent='Terkirim ✓';toast('Makasih atas testimoninya!');
          } else { sub.disabled=false;sub.textContent='Kirim Testimoni';var em=res.j&&res.j.error;toast(typeof em==='string'?em:(em&&em.message)||'Gagal mengirim'); }
        }).catch(function(){sub.disabled=false;sub.textContent='Kirim Testimoni';toast('Gagal mengirim');});
    });
  }
})();`;

/** Build OpenGraph/Twitter description without leaking content. */
/** Map persona to a body theme class (drives accent gradient). */
function personaThemeKey(d: RecapHtmlData): string {
  const t = String(d.narrative?.persona?.title || "").toLowerCase();
  if (/sultan|token/.test(t)) return "gold";
  if (/kalong|malam|night/.test(t)) return "night";
  if (/master|pro|prompt|genius/.test(t)) return "cyan";
  if (/boros|konteks/.test(t)) return "ember";
  if (/raja|juara|podium/.test(t)) return "royal";
  if (/subuh|pagi|morning/.test(t)) return "dawn";
  return "default";
}

function ogDescription(d: RecapHtmlData): string {
  const s = d.stats || {};
  const req = fmtNum(n(s, "totals.requests"));
  const tok = fmtNum(n(s, "totals.totalTokens"));
  const persona = (d.narrative?.persona?.title) ? `${d.narrative.persona.title} · ` : "";
  const rank = d.rank.requests ? `Peringkat #${d.rank.requests} · ` : "";
  return `${persona}${rank}${req} request, ${tok} token bulan ${d.monthLabel}.`.trim();
}

/** Main entry: full responsive animated recap page. */
export function renderRecapHtml(d: RecapHtmlData): string {
  const title = `Recap ${d.monthLabel} - ${d.displayName}`;
  const desc = ogDescription(d);
  const ogImg = d.avatarUrl || `${d.base}/recap-assets/misc/default.svg`;
  const hints = ((d.narrative as any)?.layoutHints || {}) as LayoutHints;
  const mood = hints.mood || "energetic";
  const moodClass = mood === "energetic" ? "" : ` mood-${mood}`;
  const sections = applyLayoutHints(buildSectionItems(d), hints).map((it) => it.html).join("\n");

  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800;12..96,900&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(ogImg)}">
<meta property="og:url" content="${escapeHtml(d.pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(ogImg)}">
<style>${RECAP_CSS}</style>
</head>
<body class="theme-${escapeHtml(personaThemeKey(d))}${moodClass}" data-url="${escapeHtml(d.pageUrl)}" data-title="${escapeHtml(title)}">
<script>window.__RECAP_CLEAN_PATH=${JSON.stringify(d.cleanPath || "")};</script>
<div class="deck">${sections}</div>
<div class="navdots" id="navDots"></div>
<div class="toast" id="toast"></div>
<script>${RECAP_JS}</script>
</body></html>`;
}



export function renderMessagePage(message: string, base: string): string {
  void base;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Recap</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100dvh;display:grid;place-items:center;background:#0b0b14;color:#fff;
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center}
.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:24px;
padding:clamp(24px,6vw,48px);max-width:520px;backdrop-filter:blur(12px)}
h1{font-size:clamp(22px,6vw,32px);margin-bottom:12px}
p{opacity:.8;font-size:clamp(15px,4vw,18px);line-height:1.5}
.emoji{font-size:48px;margin-bottom:8px}
</style></head><body><div class="card"><div class="emoji">📊</div>
<h1>Monthly Recap</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}
