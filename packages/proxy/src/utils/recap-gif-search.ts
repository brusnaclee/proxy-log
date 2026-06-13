/**
 * Realtime GIF search for recaps. Searches multiple keyless public sources at
 * generate time, VALIDATES that each candidate is actually live (not a removed/
 * "content not available" placeholder), and returns a direct media URL to store
 * in the recap so the browser renders it directly (no server-side hosting).
 *
 * Sources (no user API key):
 *  - Giphy search (public beta key)
 *  - Tenor v1 anonymous (public demo key)
 * If nothing live is found, returns null so the caller falls back to a
 * guaranteed-live local self-hosted meme GIF.
 */

const GIPHY_PUBLIC_KEY = process.env.GIPHY_API_KEY || "dc6zaTOxFJmzC"; // public beta key
const TENOR_ANON_KEY = process.env.TENOR_API_KEY || "LIVDSRZULELA"; // public demo key
const SEARCH_TIMEOUT_MS = 7000;
const VALIDATE_TIMEOUT_MS = 4000;

/** Cache candidate lists per query, and validation results per url. */
const queryCache = new Map<string, string[]>();
const validCache = new Map<string, boolean>();

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

/** Giphy search -> candidate direct gif urls (largest-but-reasonable rendition). */
async function searchGiphy(query: string, limit: number): Promise<string[]> {
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_PUBLIC_KEY)}`
    + `&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;
  const t = withTimeout(SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: t.signal }).finally(t.done);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null) as any;
    const items = Array.isArray(data?.data) ? data.data : [];
    const urls: string[] = [];
    for (const it of items) {
      const img = it?.images || {};
      const cand = img.downsized_medium?.url || img.downsized?.url || img.fixed_height?.url || img.original?.url;
      if (typeof cand === "string" && cand.startsWith("http")) urls.push(cand.split("?")[0]);
    }
    return urls;
  } catch {
    return [];
  }
}

/** Tenor v1 anonymous search -> candidate direct gif urls. */
async function searchTenor(query: string, limit: number): Promise<string[]> {
  const url = `https://g.tenor.com/v1/search?key=${encodeURIComponent(TENOR_ANON_KEY)}`
    + `&q=${encodeURIComponent(query)}&limit=${limit}&media_filter=minimal&contentfilter=high`;
  const t = withTimeout(SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: t.signal }).finally(t.done);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null) as any;
    const items = Array.isArray(data?.results) ? data.results : [];
    const urls: string[] = [];
    for (const it of items) {
      const m = Array.isArray(it?.media) ? it.media[0] : null;
      const cand = m?.gif?.url || m?.mediumgif?.url || m?.tinygif?.url;
      if (typeof cand === "string" && cand.startsWith("http")) urls.push(cand);
    }
    return urls;
  } catch {
    return [];
  }
}

/** Gather candidate urls for a query from all sources (cached). */
async function candidates(query: string, limit = 8): Promise<string[]> {
  const key = `${query}::${limit}`;
  const cached = queryCache.get(key);
  if (cached) return cached;
  const [gp, tn] = await Promise.all([searchGiphy(query, limit), searchTenor(query, limit)]);
  // Interleave sources for variety.
  const out: string[] = [];
  const max = Math.max(gp.length, tn.length);
  for (let i = 0; i < max; i++) {
    if (gp[i]) out.push(gp[i]);
    if (tn[i]) out.push(tn[i]);
  }
  queryCache.set(key, out);
  return out;
}

/**
 * Validate a GIF url is actually live and an image (not a removed placeholder).
 * Giphy serves a tiny "content not available" sticker for dead ids; we reject
 * by content-type and a minimum byte size.
 */
export async function validateGif(url: string): Promise<boolean> {
  const cached = validCache.get(url);
  if (cached !== undefined) return cached;
  const t = withTimeout(VALIDATE_TIMEOUT_MS);
  let ok = false;
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-4095", "User-Agent": "Mozilla/5.0 GroupyRecap" },
      signal: t.signal,
    }).finally(t.done);
    if (res.status === 200 || res.status === 206) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const buf = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
      const isImg = ct.startsWith("image/");
      // Giphy "content unavailable" placeholder is a tiny static gif; require
      // a real animated/photo gif by size threshold + GIF/RIFF/PNG/JPEG magic.
      const big = buf.length >= 1024;
      const magicOk = buf.length >= 4 && (
        (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) || // GIF
        (buf[0] === 0x89 && buf[1] === 0x50) || // PNG
        (buf[0] === 0xff && buf[1] === 0xd8) || // JPEG
        (buf[0] === 0x52 && buf[1] === 0x49) // RIFF/webp
      );
      ok = isImg && big && magicOk;
    }
  } catch {
    ok = false;
  }
  validCache.set(url, ok);
  return ok;
}

/**
 * Find the first LIVE gif across a list of queries. Tries each query's
 * candidates (offset by salt for variety), validating until one passes.
 * Bounded to keep generation responsive. Returns null if nothing live.
 */
export async function findLiveGif(queries: string[], salt = 0): Promise<string | null> {
  let checked = 0;
  const MAX_CHECKS = 8;
  for (const q of queries) {
    const cands = await candidates(q, 8);
    if (cands.length === 0) continue;
    // Rotate start index by salt so sections vary.
    const start = Math.abs(salt) % cands.length;
    for (let i = 0; i < cands.length && checked < MAX_CHECKS; i++) {
      const url = cands[(start + i) % cands.length];
      checked++;
      if (await validateGif(url)) return url;
    }
    if (checked >= MAX_CHECKS) break;
  }
  return null;
}

/** Backwards-compatible single search (now validated). */
export async function searchOneGif(query: string, salt = 0): Promise<string | null> {
  return findLiveGif([query], salt);
}
