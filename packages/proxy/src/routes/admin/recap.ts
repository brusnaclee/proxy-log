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
import { loadAssets } from "../../utils/recap-assets.js";

const recap = new Hono();

async function findKeyByDiscordUser(discordUserId: string) {
  return (await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)))[0];
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
  const body = await c.req.json<{ avatarUrl?: string; username?: string; force?: boolean; yearMonth?: string; interactive?: boolean }>().catch(() => ({} as any));

  const key = await findKeyByDiscordUser(discordUserId);
  if (!key) return c.json({ error: "User not found", found: false }, 404);

  const win = getRecapWindow();
  const yearMonth = body.yearMonth || win.yearMonth;
  const monthLabel = monthLabelFromYearMonth(yearMonth);
  const today = wibTodayDateStr();

  // Cache check
  const existing = (await db.select().from(userRecaps)
    .where(and(eq(userRecaps.discordUserId, discordUserId), eq(userRecaps.yearMonth, yearMonth))))[0];

  if (existing && existing.generatedDate === today && !body.force) {
    // For interactive opens, mint a fresh single-use share token each time.
    let shareToken = existing.shareToken;
    if (body.interactive) {
      shareToken = randomBytes(16).toString("hex");
      await db.update(userRecaps).set({ shareToken, shareTokenUsed: false, updatedAt: new Date() }).where(eq(userRecaps.id, existing.id));
    }
    return c.json({
      cached: true,
      apiKeyName: existing.apiKeyName || key.name,
      yearMonth,
      monthLabel,
      window: win,
      stats: safeParse(existing.statsJson),
      narrative: safeParse(existing.narrativeJson),
      rank: { requests: existing.rankRequests || 0, tokens: existing.rankTokens || 0 },
      shareToken: body.interactive ? shareToken : undefined,
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

  // Persist leaderboard snapshot (top 10 each) so the web page + bot can read it.
  await persistLeaderboard(yearMonth, leaderboard);

  // Upsert recap
  const avatarUrl = body.avatarUrl || existing?.avatarUrl || null;
  const username = body.username || key.discordUsername || existing?.discordUsername || null;
  const shareToken = body.interactive ? randomBytes(16).toString("hex") : (existing?.shareToken || null);
  const now = new Date();
  if (existing) {
    await db.update(userRecaps).set({
      avatarUrl, discordUsername: username, apiKeyName: key.name,
      generatedDate: today,
      statsJson: JSON.stringify(stats),
      narrativeJson: JSON.stringify(narrative),
      rankRequests: stats.rank.requests, rankTokens: stats.rank.tokens,
      ...(body.interactive ? { shareToken, shareTokenUsed: false } : {}),
      updatedAt: now,
    }).where(eq(userRecaps.id, existing.id));
  } else {
    await db.insert(userRecaps).values({
      apiKeyId: key.id, discordUserId, discordUsername: username, avatarUrl,
      apiKeyName: key.name, yearMonth, generatedDate: today,
      statsJson: JSON.stringify(stats), narrativeJson: JSON.stringify(narrative),
      rankRequests: stats.rank.requests, rankTokens: stats.rank.tokens,
      shareToken, shareTokenUsed: false,
    });
  }

  return c.json({
    cached: false,
    apiKeyName: key.name,
    yearMonth,
    monthLabel,
    window: win,
    stats,
    narrative,
    rank: { requests: stats.rank.requests, tokens: stats.rank.tokens },
    shareToken: body.interactive ? shareToken : undefined,
  });
});

function safeParse(s: string | null | undefined): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
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
