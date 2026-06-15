/**
 * Monthly Recap — PUBLIC animated web page.
 *
 * GET /recap/:apiKeyName  -> Spotify-Wrapped-style animated, responsive page.
 * Mounted OUTSIDE the /admin auth gate. Reads only the pre-generated
 * aggregate recap (user_recaps) + leaderboard (recap_leaderboard).
 * No API key secrets are exposed; only aggregate stats.
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { userRecaps, recapLeaderboard, apiKeys, recapTestimonials } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { getRecapWindow, monthLabelFromYearMonth, wibTodayDateStr } from "../utils/recap-window.js";
import { getAsset, fallbackForCategory, memeForCategory, assetUrl } from "../utils/recap-assets.js";
import { renderRecapHtml, renderMessagePage } from "../utils/recap-html.js";
import { dayToken } from "./admin/recap.js";
import { getMonthLeaderboard } from "../utils/recap-stats.js";
import { getRaceTimelapse } from "../utils/recap-stats.js";

const recapWeb = new Hono();

function publicBase(): string {
  return (process.env.RECAP_PUBLIC_BASE_URL || process.env.PROXY_PUBLIC_BASE_URL || "https://api.tokito.xyz").replace(/\/$/, "");
}

/** True if a stored timestamp falls on the same WIB calendar day as now. */
function sameWibDay(ts: Date | string | null | undefined): boolean {
  if (!ts) return false;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return false;
  const WIB = 7 * 60 * 60 * 1000;
  const a = new Date(d.getTime() + WIB).toISOString().slice(0, 10);
  const b = wibTodayDateStr();
  return a === b;
}

function verifyDayTokenWeb(discordUserId: string, yearMonth: string, token: string | undefined): boolean {
  if (!token) return false;
  return token === dayToken(discordUserId, yearMonth);
}

function safeParse(s: string | null | undefined): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

recapWeb.get("/:apiKeyName", async (c) => {
  const apiKeyName = decodeURIComponent(c.req.param("apiKeyName"));
  const base = publicBase();

  // Find the latest recap row for this api key name (target month preferred).
  const win = getRecapWindow();
  let row = (await db.select().from(userRecaps)
    .where(and(eq(userRecaps.apiKeyName, apiKeyName), eq(userRecaps.yearMonth, win.yearMonth))))[0];

  if (!row) {
    // fallback: most recent recap for that name
    row = (await db.select().from(userRecaps)
      .where(eq(userRecaps.apiKeyName, apiKeyName))
      .orderBy(desc(userRecaps.updatedAt)).limit(1))[0];
  }

  if (!row) {
    // Maybe the key exists but recap not generated yet.
    const key = (await db.select().from(apiKeys).where(eq(apiKeys.name, apiKeyName)))[0];
    const msg = key
      ? "Recap kamu belum dibuat. Buka tombol Recap di Discord dulu ya!"
      : "Recap tidak ditemukan.";
    return c.html(renderMessagePage(msg, base), key ? 200 : 404);
  }

  const stats = safeParse(row.statsJson);
  const narrative = safeParse(row.narrativeJson);
  const yearMonth = row.yearMonth;
  const monthLabel = monthLabelFromYearMonth(yearMonth);

  // Backfill timelapse for older cache rows that were generated before
  // `stats.race` was populated, or that hit the silent catch in the
  // generate path. Recompute on the fly so every visitor sees the section.
  if (stats && row.apiKeyId && (!stats.race || !Array.isArray(stats.race.days) || stats.race.days.length < 2)) {
    try {
      const lb = await getMonthLeaderboard(yearMonth);
      const race = await getRaceTimelapse(row.apiKeyId, yearMonth, lb);
      if (race) stats.race = race;
    } catch { /* race remains null -> section just won't render */ }
  }

  // Single-use share token: if ?t= matches and unused, mark used and mint a
  // short-lived submit token so the user can leave a testimonial. The client
  // then strips ?t= from the URL so shared/copied links are clean.
  const token = c.req.query("t");
  const tokenValid = verifyDayTokenWeb(row.discordUserId, yearMonth, token);

  // Existing testimonial (to prefill / show already-submitted state).
  const existingTesti = (await db.select().from(recapTestimonials)
    .where(and(eq(recapTestimonials.discordUserId, row.discordUserId), eq(recapTestimonials.yearMonth, yearMonth))))[0];
  const alreadySubmittedToday = !!(existingTesti && sameWibDay(existingTesti.updatedAt));

  // submitToken passed to the page only when the day token is valid; the form
  // is shown when valid AND not yet submitted today (handled in the renderer).
  const submitToken: string | null = tokenValid ? token! : null;

  // Load leaderboard for the same month.
  const lbRows = await db.select().from(recapLeaderboard)
    .where(eq(recapLeaderboard.yearMonth, yearMonth))
    .orderBy(recapLeaderboard.category, recapLeaderboard.rank);
  const lbRequests = lbRows.filter((r) => r.category === "requests");
  const lbTokens = lbRows.filter((r) => r.category === "tokens");

  // Resolve asset urls for each section choice (with category fallback).
  const sectionCategory: Record<string, string> = {
    intro: "misc", requests: "reactions", tokens: "personas",
    favoriteModel: "models", leastModel: "models",
    modelSpeed: "models", fastestModel: "models", slowestModel: "models",
    activeTime: "time", persona: "personas", rank: "ranks", race: "ranks", ide: "misc", closing: "confetti",
  };
  const resolvedAssets: Record<string, { url: string; type: string } | null> = {};
  // Priority per section: (1) realtime-searched GIF url stored in narrative.gifs,
  // (2) a local real meme GIF for the category, (3) AI-picked asset, (4) SVG.
  const seedBase = (stats?.totals?.requests || 0) + (stats?.totals?.totalTokens || 0);
  const choices = (narrative?.assetChoices || {}) as Record<string, string>;
  const gifs = (narrative?.gifs || {}) as Record<string, string>;
  const sectionKeys = ["intro","stats","requests","tokens","favoriteModel","leastModel","modelSpeed","fastestModel","slowestModel","activeTime","persona","rank","race","ide","closing"];
  sectionKeys.forEach((section, i) => {
    const searched = gifs[section];
    if (searched && /^https?:\/\//.test(searched)) {
      resolvedAssets[section] = { url: searched, type: "gif" };
      return;
    }
    const cat = sectionCategory[section] || "misc";
    let asset = memeForCategory(cat, [], seedBase + i);
    if (!asset && choices[section]) asset = getAsset(choices[section]);
    if (!asset) asset = fallbackForCategory(cat);
    resolvedAssets[section] = asset ? { url: assetUrl(base, asset.file), type: asset.type } : null;
  });

  const html = renderRecapHtml({
    apiKeyName,
    displayName: row.discordUsername || apiKeyName,
    avatarUrl: row.avatarUrl,
    monthLabel,
    yearMonth,
    stats,
    narrative,
    resolvedAssets,
    leaderboard: { byRequests: lbRequests, byTokens: lbTokens },
    rank: { requests: row.rankRequests || 0, tokens: row.rankTokens || 0 },
    base,
    pageUrl: `${base}/recap/${encodeURIComponent(apiKeyName)}`,
    viewerDiscordUserId: row.discordUserId,
    submitToken,
    alreadySubmittedToday,
    existingTestimonial: existingTesti ? { stars: existingTesti.stars, body: existingTesti.body } : null,
    cleanPath: `/recap/${encodeURIComponent(apiKeyName)}`,
    cardMeta: (narrative && narrative.card) || null,
  });

  return c.html(html);
});

/**
 * Public testimonial submission. Requires a valid HMAC submit-token that the
 * page minted after a valid single-use share token. Upserts per user/month.
 */
recapWeb.post("/testimonial", async (c) => {
  const body = await c.req.json<{ token?: string; userId?: string; yearMonth?: string; stars?: number; body?: string }>().catch(() => null);
  if (!body || !body.token || !body.userId) return c.json({ error: "token required" }, 400);

  const yearMonth = body.yearMonth || getRecapWindow().yearMonth;
  const discordUserId = String(body.userId);
  if (!verifyDayTokenWeb(discordUserId, yearMonth, body.token)) {
    return c.json({ error: "Token tidak valid. Buka recap dari Discord ya." }, 403);
  }

  const stars = Math.max(1, Math.min(5, Math.round(Number(body.stars) || 0)));
  const text = String(body.body || "").slice(0, 500).trim();
  if (!stars) return c.json({ error: "Beri bintang dulu ya." }, 400);

  // Pull identity + rank from the user's recap row to display alongside.
  const recapRow = (await db.select().from(userRecaps)
    .where(and(eq(userRecaps.discordUserId, discordUserId), eq(userRecaps.yearMonth, yearMonth))))[0];

  const existing = (await db.select().from(recapTestimonials)
    .where(and(eq(recapTestimonials.discordUserId, discordUserId), eq(recapTestimonials.yearMonth, yearMonth))))[0];

  // One submit per WIB day.
  if (existing && sameWibDay(existing.updatedAt)) {
    return c.json({ error: "Kamu udah kasih testimoni hari ini. Coba lagi besok ya 🙌" }, 429);
  }

  const now = new Date();
  const fields = {
    discordUsername: recapRow?.discordUsername || null,
    avatarUrl: recapRow?.avatarUrl || null,
    apiKeyName: recapRow?.apiKeyName || null,
    stars,
    body: text,
    rankRequests: recapRow?.rankRequests || 0,
    rankTokens: recapRow?.rankTokens || 0,
    updatedAt: now,
  };

  if (existing) {
    await db.update(recapTestimonials).set(fields).where(eq(recapTestimonials.id, existing.id));
  } else {
    await db.insert(recapTestimonials).values({ discordUserId, yearMonth, ...fields });
  }

  return c.json({ success: true });
});

export default recapWeb;
