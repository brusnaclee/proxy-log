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
import { userRecaps, recapLeaderboard, apiKeys } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { getRecapWindow, monthLabelFromYearMonth } from "../utils/recap-window.js";
import { getAsset, fallbackForCategory, assetUrl } from "../utils/recap-assets.js";
import { renderRecapHtml, renderMessagePage } from "../utils/recap-html.js";

const recapWeb = new Hono();

function publicBase(): string {
  return (process.env.RECAP_PUBLIC_BASE_URL || process.env.PROXY_PUBLIC_BASE_URL || "https://api.tokito.xyz").replace(/\/$/, "");
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

  // Load leaderboard for the same month.
  const lbRows = await db.select().from(recapLeaderboard)
    .where(eq(recapLeaderboard.yearMonth, yearMonth))
    .orderBy(recapLeaderboard.category, recapLeaderboard.rank);
  const lbRequests = lbRows.filter((r) => r.category === "requests");
  const lbTokens = lbRows.filter((r) => r.category === "tokens");

  // Resolve asset urls for each section choice (with category fallback).
  const sectionCategory: Record<string, string> = {
    intro: "misc", requests: "reactions", tokens: "personas",
    favoriteModel: "models", leastModel: "models", activeTime: "time",
    persona: "personas", rank: "ranks", ide: "misc", closing: "confetti",
  };
  const resolvedAssets: Record<string, { url: string; type: string } | null> = {};
  if (narrative?.assetChoices) {
    for (const [section, id] of Object.entries(narrative.assetChoices as Record<string, string>)) {
      let asset = getAsset(id);
      if (!asset) asset = fallbackForCategory(sectionCategory[section] || "misc");
      resolvedAssets[section] = asset ? { url: assetUrl(base, asset.file), type: asset.type } : null;
    }
  }

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
  });

  return c.html(html);
});

export default recapWeb;
