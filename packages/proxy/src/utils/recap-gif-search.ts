/**
 * Realtime GIF search for recaps. Searches public GIF sources at generate time,
 * resolves a direct media URL, and returns it to be stored in the recap so the
 * browser renders it directly (no server-side download/hosting).
 *
 * No user API key required: uses Giphy's well-known public beta key. If search
 * fails/times out, callers fall back to the curated catalog (recap-gifs.ts),
 * then to local meme GIFs / animated SVGs, so media is never broken.
 */

const GIPHY_PUBLIC_KEY = process.env.GIPHY_API_KEY || "dc6zaTOxFJmzC"; // public beta key
const SEARCH_TIMEOUT_MS = 8000;

/** In-memory cache so repeated queries in one batch don't re-hit the API. */
const cache = new Map<string, string[]>();

function pickRating(): string {
  return "pg-13";
}

/**
 * Search Giphy for a query and return up to `limit` direct GIF media URLs.
 * Returns [] on any failure (caller handles fallback).
 */
export async function searchGifs(query: string, limit = 5): Promise<string[]> {
  const key = `${query}::${limit}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_PUBLIC_KEY)}`
    + `&q=${encodeURIComponent(query)}&limit=${limit}&rating=${pickRating()}&bundle=messaging_non_clips`;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(to));
    if (!res.ok) return [];
    const data = await res.json().catch(() => null) as any;
    const items = Array.isArray(data?.data) ? data.data : [];
    const urls: string[] = [];
    for (const it of items) {
      // Prefer a reasonably sized, widely-compatible gif rendition.
      const img = it?.images || {};
      const cand = img.downsized_medium?.url || img.downsized?.url || img.original?.url || img.fixed_height?.url;
      if (typeof cand === "string" && cand.startsWith("http")) {
        // Strip query params/trackers; keep stable media URL.
        urls.push(cand.split("?")[0]);
      }
    }
    cache.set(key, urls);
    return urls;
  } catch {
    return [];
  }
}

/**
 * Resolve ONE gif url for a query, deterministically choosing among results by
 * a numeric salt so different sections pick different gifs from the same query.
 */
export async function searchOneGif(query: string, salt = 0): Promise<string | null> {
  const urls = await searchGifs(query, 5);
  if (urls.length === 0) return null;
  return urls[Math.abs(salt) % urls.length];
}
