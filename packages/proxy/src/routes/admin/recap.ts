/**
 * Monthly Recap — internal API (mounted under /admin, behind internal-secret auth).
 *
 * Endpoints (called by the Discord bot via x-internal-secret):
 *  - GET  /internal/recap/window                      -> current access window
 *  - POST /internal/recap/:discordUserId              -> generate-or-cached recap (daily)
 *  - GET  /internal/recap/leaderboard?yearMonth=...   -> stored leaderboard
 *  - POST /internal/recap/leaderboard-avatars         -> push resolved avatars/usernames
 *
 * PRIVACY: only aggregate stats are computed/stored (see recap-stats.ts guard).
 */

import { Hono } from "hono";
import { randomBytes, createHmac } from "node:crypto";
import { db } from "../../db/index.js";
import { apiKeys, userRecaps, recapLeaderboard, recapTestimonials } from "../../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  getRecapWindow,
  wibTodayDateStr,
  previousYearMonth,
  monthLabelFromYearMonth,
} from "../../utils/recap-window.js";
import {
  getRecapStats,
  getMonthLeaderboard,
  enrichRankAndComparison,
  getRaceTimelapse,
  type LeaderboardEntry,
} from "../../utils/recap-stats.js";
import { generateNarrative } from "../../utils/recap-generator.js";
import { loadAssets, memeForCategory, assetUrl } from "../../utils/recap-assets.js";
import { findLiveGif } from "../../utils/recap-gif-search.js";
import { type GifCategory } from "../../utils/recap-gifs.js";
import { resolveCardMeta } from "../../utils/recap-card-meta.js";
import { isInternalRequest } from "../../middleware/session.js";

const recap = new Hono();

async function findKeyByDiscordUser(discordUserId: string) {
  return (await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)))[0];
}

function publicBase(): string {
  return (process.env.RECAP_PUBLIC_BASE_URL || process.env.PROXY_PUBLIC_BASE_URL || "https://api.tokito.xyz").replace(/\/$/, "");
}

recap.get("/internal/recap/window", (c) => {
  return c.json(getRecapWindow());
});

/**
 * Generate (or return cached) recap for a user for the current target month.
 * Body: { avatarUrl?, username?, force?, yearMonth? }
 * Cached per WIB day: same day -> reuse; new day -> regenerate.
 */
recap.post("/internal/recap/:discordUserId", async (c) => {
  const discordUserId = c.req.param("discordUserId");
  const body = await c.req.json<{ avatarUrl?: string; username?: string; force?: boolean; skipIfToday?: boolean; yearMonth?: string; interactive?: boolean }>().catch(() => ({} as any));

  const key = await findKeyByDiscordUser(discordUserId);

  const win = getRecapWindow();
  const yearMonth = body.yearMonth || win.yearMonth;
  const monthLabel = monthLabelFromYearMonth(yearMonth);
  const today = wibTodayDateStr();

  // Cache check (does not require an active/existing key).
  const existing = (await db.select().from(userRecaps)
    .where(and(eq(userRecaps.discordUserId, discordUserId), eq(userRecaps.yearMonth, yearMonth))))[0];

  // No API key (disabled/deleted): still allow viewing if a recap row exists.
  if (!key) {
    if (existing) {
      return c.json({
        cached: true,
        apiKeyName: existing.apiKeyName || null,
        yearMonth,
        monthLabel,
        window: win,
        stats: safeParse(existing.statsJson),
        narrative: safeParse(existing.narrativeJson),
        rank: { requests: existing.rankRequests || 0, tokens: existing.rankTokens || 0 },
        shareToken: body.interactive ? dayToken(discordUserId, yearMonth) : undefined,
      });
    }
    return c.json({ error: "User not found", found: false }, 404);
  }

  if (existing && existing.generatedDate === today && (body.skipIfToday || !body.force)) {
    // For interactive opens, mint a fresh single-use share token each time.
    let shareToken = existing.shareToken;
    if (body.interactive) {
      shareToken = randomBytes(16).toString("hex");
      await db.update(userRecaps).set({ shareToken, shareTokenUsed: false, updatedAt: new Date() }).where(eq(userRecaps.id, existing.id));
    }
    const cachedStats = safeParse(existing.statsJson) || {};
    // Backfill timelapse on cache hit so older rows (pre-race feature, or
    // generated when the silent catch fired) get the section on next open.
    if (!cachedStats.race || !Array.isArray(cachedStats.race?.days) || cachedStats.race.days.length < 2) {
      try {
        const lb = await getMonthLeaderboard(yearMonth);
        const race = await getRaceTimelapse(key.id, yearMonth, lb);
        if (race) {
          cachedStats.race = race;
          await db.update(userRecaps).set({ statsJson: JSON.stringify(cachedStats), updatedAt: new Date() }).where(eq(userRecaps.id, existing.id));
        }
      } catch { /* leave stats as-is */ }
    }
    return c.json({
      cached: true,
      apiKeyName: existing.apiKeyName || key.name,
      yearMonth,
      monthLabel,
      window: win,
      stats: cachedStats,
      narrative: safeParse(existing.narrativeJson),
      rank: { requests: existing.rankRequests || 0, tokens: existing.rankTokens || 0 },
      shareToken: body.interactive ? dayToken(discordUserId, yearMonth) : undefined,
    });
  }

  // Compute fresh stats + ranks
  const stats = await getRecapStats(key.id, yearMonth);
  const leaderboard = await getMonthLeaderboard(yearMonth);
  await enrichRankAndComparison(stats, key.id, leaderboard, previousYearMonth(yearMonth));
  try {
    stats.race = await getRaceTimelapse(key.id, yearMonth, leaderboard);
  } catch { stats.race = null; }

  const assets = loadAssets();
  // Interactive: fewer retries to stay responsive; background: more retries.
  const { ok, narrative } = await generateNarrative(stats, monthLabel, assets, { retries: body.interactive ? 10 : 3 });

  // Interactive request that couldn't get AI output -> tell the bot we're busy
  // (do NOT cache a fallback so a later attempt can still produce a real recap).
  if (body.interactive && !ok && !existing) {
    return c.json({ busy: true, error: "AI busy" }, 503);
  }

  // Resolve a varied, live GIF per section: realtime search + local fallback.
  try {
    narrative.gifs = await resolveRecapGifs(discordUserId, stats, publicBase());
  } catch { narrative.gifs = {}; }

  // Resolve the live anime wallpaper + nested tile plan for the shareable card.
  try {
    narrative.card = await resolveCardMeta(discordUserId, stats, narrative, publicBase());
  } catch { narrative.card = null; }

  // Persist leaderboard snapshot (top 10 each) so the web page + bot can read it.
  await persistLeaderboard(yearMonth, leaderboard);

  // Upsert recap
  const avatarUrl = body.avatarUrl || existing?.avatarUrl || null;
  const username = body.username || key.discordUsername || existing?.discordUsername || null;
  const shareToken = body.interactive ? randomBytes(16).toString("hex") : (existing?.shareToken || null);
  const now = new Date();
  // Atomic upsert on the (discord_user_id, year_month) unique index to avoid
  // duplicate-key races when the daily job and an interactive open overlap.
  const updateSet: Record<string, any> = {
    avatarUrl, discordUsername: username, apiKeyName: key.name,
    generatedDate: today,
    statsJson: JSON.stringify(stats),
    narrativeJson: JSON.stringify(narrative),
    rankRequests: stats.rank.requests, rankTokens: stats.rank.tokens,
    updatedAt: now,
  };
  if (body.interactive) { updateSet.shareToken = shareToken; updateSet.shareTokenUsed = false; }
  await db.insert(userRecaps).values({
    apiKeyId: key.id, discordUserId, discordUsername: username, avatarUrl,
    apiKeyName: key.name, yearMonth, generatedDate: today,
    statsJson: JSON.stringify(stats), narrativeJson: JSON.stringify(narrative),
    rankRequests: stats.rank.requests, rankTokens: stats.rank.tokens,
    shareToken, shareTokenUsed: false,
  }).onConflictDoUpdate({
    target: [userRecaps.discordUserId, userRecaps.yearMonth],
    set: updateSet,
  });

  return c.json({
    cached: false,
    apiKeyName: key.name,
    yearMonth,
    monthLabel,
    window: win,
    stats,
    narrative,
    rank: { requests: stats.rank.requests, tokens: stats.rank.tokens },
    shareToken: body.interactive ? dayToken(discordUserId, yearMonth) : undefined,
  });
});

function safeParse(s: string | null | undefined): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Resolve a varied GIF URL per recap section. Tries realtime GIF search with a
 * mood-appropriate query first, then falls back to the curated catalog. Returns
 * a map of section -> url; the web has further onerror fallbacks (local meme/SVG).
 */
async function resolveRecapGifs(seedId: string, stats: any, base: string): Promise<Record<string, string>> {
  const ratio = stats?.totals?.ioRatio ?? 0.3;
  const rank = stats?.rank?.requests || 0;
  const hr = stats?.activity?.mostActiveHour?.hour ?? 12;
  const timeQ = hr < 5 ? ["night owl coding", "tired sleepy late night"] : hr < 11 ? ["good morning coffee", "morning energetic"] : hr < 18 ? ["working hard typing", "busy office"] : ["late night coding", "evening relax"];
  const rankQ = rank === 1 ? ["champion winner king", "number one celebrate"] : rank <= 3 ? ["podium celebrate trophy", "winner proud"] : rank <= 10 ? ["proud clapping nice", "good job thumbs up"] : rank <= 30 ? ["keep going fight", "determined work harder"] : ["try harder sad", "crying funny"];
  const personaQ = ratio < 0.15 ? ["money burning cash", "spending money funny"] : ratio >= 0.45 ? ["genius smart galaxy brain", "big brain proud"] : ["coding chill relax", "developer typing"];

  // section -> { queries[], catalog fallback category }
  const plan: Record<string, { q: string[]; cat: GifCategory }> = {
    intro: { q: ["lets go excited", "hello hype start"], cat: "intro" },
    requests: { q: rank <= 10 ? ["fast typing keyboard hacker", "frantic typing"] : ["typing computer work", "developer coding"], cat: "many" },
    tokens: { q: personaQ, cat: ratio < 0.15 ? "money" : "proud" },
    favoriteModel: { q: ["best friend love", "favorite hug love"], cat: "favorite" },
    leastModel: { q: ["forgotten lonely ignored", "sad alone left out"], cat: "forgotten" },
    fastestModel: { q: ["fast speed zoom flash", "super fast race"], cat: "fast" },
    slowestModel: { q: ["slow waiting loading", "snail slow tired"], cat: "slow" },
    activeTime: { q: timeQ, cat: hr < 5 ? "night" : hr < 11 ? "morning" : "noon" },
    persona: { q: personaQ, cat: ratio < 0.15 ? "boros" : ratio >= 0.45 ? "proud" : "coding" },
    rank: { q: rankQ, cat: rank === 1 ? "king" : rank <= 3 ? "podium" : rank <= 30 ? "midrank" : "lowrank" },
    race: { q: ["race climbing finish line", "competition running"], cat: "race" },
    closing: { q: ["celebrate party congrats", "happy dance celebrate"], cat: "celebrate" },
  };

  const out: Record<string, string> = {};
  const sections = Object.entries(plan);
  let salt = 0;
  // Run searches with bounded concurrency; live-validate, else local meme gif.
  await Promise.all(sections.map(async ([section, { q, cat }]) => {
    const s = seedFromStr(seedId) + (salt++);
    let url: string | null = null;
    try { url = await findLiveGif(q, s); } catch { url = null; }
    if (!url) {
      // Guaranteed-live local self-hosted meme gif (absolute URL).
      const local = memeForCategory(cat as any, [], s);
      if (local) url = assetUrl(base, local.file);
    }
    if (url) out[section] = url;
  }));
  return out;
}

function seedFromStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 997;
}

/** Store top-10 (by requests and tokens) into recap_leaderboard, preserving any avatars. */
async function persistLeaderboard(
  yearMonth: string,
  leaderboard: { byRequests: LeaderboardEntry[]; byTokens: LeaderboardEntry[] },
) {
  // Keep previously-resolved avatars/usernames so we don't lose them on regenerate.
  const prior = await db.select().from(recapLeaderboard).where(eq(recapLeaderboard.yearMonth, yearMonth));
  const avatarByUser = new Map<string, { avatarUrl: string | null; username: string | null }>();
  for (const p of prior) {
    if (p.discordUserId) avatarByUser.set(p.discordUserId, { avatarUrl: p.avatarUrl, username: p.discordUsername });
  }

  await db.delete(recapLeaderboard).where(eq(recapLeaderboard.yearMonth, yearMonth));

  const rows: any[] = [];
  const build = (list: LeaderboardEntry[], category: "requests" | "tokens") => {
    list.filter((e) => (category === "requests" ? e.requests > 0 : e.tokens > 0))
      .slice(0, 10)
      .forEach((e, i) => {
        const prev = e.discordUserId ? avatarByUser.get(e.discordUserId) : undefined;
        rows.push({
          yearMonth, category, rank: i + 1,
          discordUserId: e.discordUserId,
          discordUsername: e.discordUsername || prev?.username || null,
          avatarUrl: prev?.avatarUrl || null,
          value: category === "requests" ? e.requests : e.tokens,
        });
      });
  };
  build(leaderboard.byRequests, "requests");
  build(leaderboard.byTokens, "tokens");
  if (rows.length) await db.insert(recapLeaderboard).values(rows);
}

/** Return stored leaderboard for a month (defaults to current target month). */
recap.get("/internal/recap/leaderboard", async (c) => {
  const yearMonth = c.req.query("yearMonth") || getRecapWindow().yearMonth;
  const rows = await db.select().from(recapLeaderboard)
    .where(eq(recapLeaderboard.yearMonth, yearMonth))
    .orderBy(recapLeaderboard.category, recapLeaderboard.rank);
  const byRequests = rows.filter((r) => r.category === "requests");
  const byTokens = rows.filter((r) => r.category === "tokens");
  return c.json({ yearMonth, byRequests, byTokens });
});

/**
 * Push resolved Discord avatars/usernames for leaderboard entries.
 * Body: { yearMonth?, avatars: [{ discordUserId, avatarUrl, username }] }
 */
recap.post("/internal/recap/leaderboard-avatars", async (c) => {
  const body = await c.req.json<{ yearMonth?: string; avatars: Array<{ discordUserId: string; avatarUrl?: string; username?: string }> }>().catch(() => null);
  if (!body || !Array.isArray(body.avatars)) return c.json({ error: "avatars array required" }, 400);
  const yearMonth = body.yearMonth || getRecapWindow().yearMonth;

  let updated = 0;
  for (const a of body.avatars) {
    if (!a.discordUserId) continue;
    const set: Record<string, any> = {};
    if (a.avatarUrl) set.avatarUrl = a.avatarUrl;
    if (a.username) set.discordUsername = a.username;
    if (Object.keys(set).length === 0) continue;
    await db.update(recapLeaderboard).set(set)
      .where(and(eq(recapLeaderboard.yearMonth, yearMonth), eq(recapLeaderboard.discordUserId, a.discordUserId)));
    // also reflect on the user's own recap row
    await db.update(userRecaps).set(set)
      .where(and(eq(userRecaps.discordUserId, a.discordUserId), eq(userRecaps.yearMonth, yearMonth)));
    updated++;
  }
  return c.json({ success: true, updated });
});

/**
 * Wipe all generated recap data so the next interactive open regenerates from
 * scratch. Use after schema changes (e.g. speed duo / race backfill) or as a
 * general "reset recap" button from the dashboard.
 *
 * Auth: requires INTERNAL_API_SECRET via x-internal-secret header (same as the
 * other internal routes). Body:
 *   { yearMonth?: "YYYY-MM" | "all" }   default: current window
 *   { includeTestimonials?: boolean }    default: true
 */
recap.post("/internal/recap/reset", async (c) => {
  if (!isInternalRequest(c)) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ yearMonth?: string; includeTestimonials?: boolean }>().catch(() => ({} as any)) || {};
  const includeTestimonials = body.includeTestimonials !== false;

  try {
    const ym = (body.yearMonth || getRecapWindow().yearMonth).trim();
    if (ym === "all") {
      await db.delete(recapLeaderboard);
      await db.delete(userRecaps);
      if (includeTestimonials) await db.delete(recapTestimonials);
      return c.json({ success: true, scope: "all", leaderboardDeleted: true, recapsDeleted: true, testimonialsDeleted: includeTestimonials });
    }
    if (!/^\d{4}-\d{2}$/.test(ym)) return c.json({ error: "yearMonth must be YYYY-MM or 'all'" }, 400);
    const lb = await db.delete(recapLeaderboard).where(eq(recapLeaderboard.yearMonth, ym)).returning();
    const ur = await db.delete(userRecaps).where(eq(userRecaps.yearMonth, ym)).returning();
    let te: any[] = [];
    if (includeTestimonials) te = await db.delete(recapTestimonials).where(eq(recapTestimonials.yearMonth, ym)).returning();
    return c.json({
      success: true,
      scope: ym,
      leaderboardDeleted: lb.length,
      recapsDeleted: ur.length,
      testimonialsDeleted: te.length,
    });
  } catch (err: any) {
    return c.json({ error: "reset failed", detail: err?.message || String(err) }, 500);
  }
});

/** List discord users that have a key (for the daily batch regenerate job). */
recap.get("/internal/recap/users", async (c) => {
  const rows = await db.select({ discordUserId: apiKeys.discordUserId, name: apiKeys.name })
    .from(apiKeys).where(sql`discord_user_id IS NOT NULL AND is_active = true`);
  return c.json({ users: rows });
});

// ─── Testimonials ────────────────────────────────────────────────────────────
// HMAC submit-token: signs "discordUserId:yearMonth:exp" with SESSION_SECRET.
// Minted by the web page only after a valid single-use share token, so only a
// user who opened their own recap from Discord can submit a testimonial.

function submitSecret(): string {
  return process.env.SESSION_SECRET || process.env.INTERNAL_API_SECRET || "recap-fallback-secret";
}

/**
 * Deterministic per-day token for testimonials.
 * Same value all day (so pressing the button again returns the same token),
 * changes the next WIB day. Validated by recomputation, no DB state needed.
 */
export function dayToken(discordUserId: string, yearMonth: string, wibDate?: string): string {
  const day = wibDate || wibTodayDateStr();
  const payload = `${discordUserId}:${yearMonth}:${day}`;
  return createHmac("sha256", submitSecret()).update(payload).digest("hex").slice(0, 24);
}

/** Verify a day token by recomputation against today's WIB date. */
function verifyDayToken(discordUserId: string, yearMonth: string, token: string): boolean {
  if (!token) return false;
  return token === dayToken(discordUserId, yearMonth);
}

// List testimonials for a month (for the Discord viewer).
recap.get("/internal/recap/testimonials", async (c) => {
  const yearMonth = c.req.query("yearMonth") || getRecapWindow().yearMonth;
  const rows = await db.select().from(recapTestimonials)
    .where(eq(recapTestimonials.yearMonth, yearMonth))
    .orderBy(desc(recapTestimonials.updatedAt));
  return c.json({ yearMonth, testimonials: rows });
});

export default recap;
