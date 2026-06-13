/**
 * Recap media asset library loader.
 *
 * Loads packages/proxy/public/recap-assets/manifest.json once at startup and
 * provides lookup + category-fallback helpers. The manifest lists curated
 * memes/gifs/png/video that the AI may choose from per recap section.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RecapAsset {
  id: string;
  category: string; // personas | ranks | models | time | reactions | confetti | misc
  type: "img" | "gif" | "video";
  file: string; // relative path under /recap-assets/
  tags?: string[];
  caption?: string;
}

let cache: RecapAsset[] | null = null;

/** Resolve the assets directory (works in dist and src). */
function assetsDir(): string {
  // This file lives in src/utils or dist/. Assets are at packages/proxy/public/recap-assets.
  // Walk up to the package root then into public.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../public/recap-assets"),
    resolve(here, "../public/recap-assets"),
    resolve(process.cwd(), "public/recap-assets"),
    resolve(process.cwd(), "packages/proxy/public/recap-assets"),
  ];
  for (const c of candidates) {
    if (existsSync(resolve(c, "manifest.json"))) return c;
  }
  return candidates[0];
}

/** Load (and cache) the asset manifest. Returns [] if missing/invalid. */
export function loadAssets(force = false): RecapAsset[] {
  if (cache && !force) return cache;
  try {
    const manifestPath = resolve(assetsDir(), "manifest.json");
    if (!existsSync(manifestPath)) {
      cache = [];
      return cache;
    }
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const arr: RecapAsset[] = Array.isArray(raw) ? raw : Array.isArray(raw?.assets) ? raw.assets : [];
    cache = arr.filter((a) => a && typeof a.id === "string" && typeof a.file === "string");
  } catch {
    cache = [];
  }
  return cache;
}

/** Get an asset by id. */
export function getAsset(id: string): RecapAsset | undefined {
  return loadAssets().find((a) => a.id === id);
}

/** First asset matching a category (deterministic fallback). */
export function fallbackForCategory(category: string): RecapAsset | undefined {
  const all = loadAssets();
  // Prefer a real meme (gif/img file under memes/) over the emoji SVG fallback.
  return all.find((a) => a.category === category && isMeme(a)) || all.find((a) => a.category === category);
}

/** True if the asset is a real meme file (not the emoji-SVG fallback set). */
export function isMeme(a: RecapAsset): boolean {
  return a.type === "gif" || (typeof a.file === "string" && a.file.startsWith("memes/"));
}

/**
 * Pick a real meme for a category, optionally biased by tags, with a stable
 * seed so the same user gets a stable-but-varied choice. Falls back to any
 * meme in the category, then any asset in the category, then undefined.
 */
export function memeForCategory(category: string, tags: string[] = [], seed = 0): RecapAsset | undefined {
  const all = loadAssets();
  const memes = all.filter((a) => a.category === category && isMeme(a));
  if (memes.length === 0) return fallbackForCategory(category);
  if (tags.length) {
    const tagged = memes.filter((a) => (a.tags || []).some((t) => tags.includes(t)));
    if (tagged.length) return tagged[seed % tagged.length];
  }
  return memes[seed % memes.length];
}

/** Build the public URL for an asset file. */
export function assetUrl(baseUrl: string, file: string): string {
  const clean = baseUrl.replace(/\/$/, "");
  const f = file.replace(/^\//, "");
  return `${clean}/recap-assets/${f}`;
}
