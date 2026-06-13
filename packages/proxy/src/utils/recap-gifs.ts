/**
 * Recap GIF catalog — curated DIRECT media URLs (no download, rendered straight
 * from the browser). Each recap picks MULTIPLE varied GIFs (seeded by user) and
 * stores the resolved URLs so the web just renders them. The web has an onerror
 * chain (next candidate -> local meme -> SVG) so a dead link never breaks.
 *
 * Categories map to recap sections + persona/rank/time/model moods.
 */

export type GifCategory =
  | "intro" | "hype" | "many" | "sad" | "sweat" | "proud" | "boros"
  | "night" | "morning" | "noon" | "fast" | "slow" | "favorite"
  | "forgotten" | "celebrate" | "king" | "podium" | "midrank" | "lowrank"
  | "race" | "coding" | "tools" | "money" | "tired";

interface Gif { url: string; cats: GifCategory[] }

// Helper: Giphy direct media URL from an id.
const g = (id: string): string => `https://media.giphy.com/media/${id}/giphy.gif`;

// Curated entries. Each GIF can belong to several moods so selection stays varied.
// IDs are real Giphy media ids; any that fail at runtime fall back gracefully.
const CATALOG: Gif[] = [
  // intro / general coding hype
  { url: g("26tn33aiTi1jkl6H6"), cats: ["intro", "coding"] },
  { url: g("3o7abKhOpu0NwenH3O"), cats: ["intro", "hype"] },
  { url: g("L1R1tvI9svkIWwpVYr"), cats: ["intro", "coding"] },
  { url: g("13HgwGsXF0aiGY"), cats: ["intro", "hype"] },
  { url: g("ZVik7pBtu9dNS"), cats: ["intro", "coding"] },
  { url: g("JIX9t2j0ZTN9S"), cats: ["intro"] },
  // hype / many requests
  { url: g("l0HlNaQ6gWfllcjDO"), cats: ["hype", "many"] },
  { url: g("xT0xezQGU5xCDJuCPe"), cats: ["hype", "many"] },
  { url: g("l0HlPystfePnAI3G8"), cats: ["hype"] },
  { url: g("3oEjI6SIIHBdRxXI40"), cats: ["sweat", "many"] },
  { url: g("13GIgrGdslD9oQ"), cats: ["fast", "coding", "many"] },
  { url: g("l3q2K5jinAlChoCLS"), cats: ["hype", "many"] },
  // sweat / hard work / stress
  { url: g("Y0nUQXfYr4QG6P9HFw"), cats: ["sweat", "tired"] },
  { url: g("3oEjI6SIIHBdRxXI40"), cats: ["sweat"] },
  { url: g("l0Iy6Z1Q4Q8w0Q8w0"), cats: ["sweat"] },
  { url: g("26ufdipQqU2lhNA4g"), cats: ["sweat", "tired"] },
  // sad / low usage / forgotten
  { url: g("d2lcHJTG5Tscg"), cats: ["sad", "lowrank"] },
  { url: g("OPU6wzx8JrHna"), cats: ["sad", "forgotten"] },
  { url: g("9Y5BbDSkSTiY8"), cats: ["sad"] },
  { url: g("ISOckXUybVfQ4"), cats: ["sad", "forgotten"] },
  { url: g("H4DjXQXamtTiIuCcRU"), cats: ["forgotten", "sad"] },
  // proud / pro / master prompt
  { url: g("111ebonMs90YLu"), cats: ["proud"] },
  { url: g("3o6Zt481isNVuQI1l6"), cats: ["proud"] },
  { url: g("3o7TKMt1VVNkHV2PaE"), cats: ["proud"] },
  { url: g("l0MYGb1LuZ3n7dRnO"), cats: ["king", "proud"] },
  { url: g("a0h7sAqON67nO"), cats: ["proud"] },
  // boros / wasteful / money burn
  { url: g("l0MYt5jPR6QX5pnqM"), cats: ["boros", "money"] },
  { url: g("xUNd9HZq1itMkiK652"), cats: ["boros", "money"] },
  { url: g("3o85xIO33l7RlmLR4I"), cats: ["boros", "money"] },
  { url: g("UVGNeBdRPdW1y"), cats: ["money", "boros"] },
  // night owl / tired / coffee
  { url: g("7SF5scGB2AFrgsXP63"), cats: ["night", "tired"] },
  { url: g("QBd2kLB5qDmysEXre9"), cats: ["night", "coding"] },
  { url: g("Ok5cBfDz8oFLG"), cats: ["night", "tired"] },
  { url: g("3oEjHV0z8S7WM4MwnK"), cats: ["tired", "night"] },
  // morning / noon
  { url: g("3o6Zt6ML6BklcajjsA"), cats: ["morning"] },
  { url: g("xT1XGzAFQNvDgUM98Y"), cats: ["morning"] },
  { url: g("l0MYB8Ory7Hqefo9a"), cats: ["noon"] },
  // fast / slow models
  { url: g("l0HlMr2pdQO3iZnDi"), cats: ["fast"] },
  { url: g("3o7TKnCdBx5cMo0jXi"), cats: ["fast"] },
  { url: g("tXL4FHPSnVJ0A"), cats: ["slow"] },
  { url: g("RKHkm5ZVrEsmI"), cats: ["slow", "tired"] },
  // favorite model / love
  { url: g("26FLdmIp6wJr91JAI"), cats: ["favorite"] },
  { url: g("l2JhxfHWMBWtJseTK"), cats: ["favorite"] },
  { url: g("3o7TKF1fSIs1R19B8k"), cats: ["favorite"] },
  // rank tiers
  { url: g("g9582DNuQppxC"), cats: ["celebrate", "king"] },
  { url: g("26u4cqiYI30juCOGY"), cats: ["celebrate"] },
  { url: g("7rj2ZgttvgomY"), cats: ["midrank", "celebrate"] },
  { url: g("l0MYEqEzwMWFCg8rm"), cats: ["podium"] },
  { url: g("3ohzdIuqJoo8QdKlnW"), cats: ["lowrank"] },
  // race / climbing
  { url: g("3oKIPnAiaMCws8nOsE"), cats: ["race"] },
  { url: g("l46Cy1rHbQ92uuLXa"), cats: ["race"] },
  // tools / agentic / coding
  { url: g("LmNwrBhejkK9EFP504"), cats: ["tools", "coding"] },
  { url: g("12NUbkX6p4xOO4"), cats: ["coding"] },
  { url: g("WUlplcMpOCEmTGBtBW"), cats: ["coding", "tools"] },
];

/** FNV-ish small hash from a string seed. */
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** All catalog URLs for a category. */
function poolFor(cat: GifCategory): string[] {
  return CATALOG.filter((x) => x.cats.includes(cat)).map((x) => x.url);
}

/**
 * Deterministically pick one GIF URL for a category given a seed + salt, so the
 * same user gets a stable choice but different users/sections vary.
 */
export function pickGif(cat: GifCategory, seed: string, salt = 0): string | null {
  const pool = poolFor(cat);
  if (pool.length === 0) return null;
  const idx = (seedFrom(seed) + salt * 2654435761) % pool.length;
  return pool[idx];
}

/** Pick GIFs for many sections at once, biased by the user's profile. */
export function pickRecapGifs(seed: string, sectionCats: Record<string, GifCategory[]>): Record<string, string> {
  const out: Record<string, string> = {};
  let salt = 0;
  for (const [section, cats] of Object.entries(sectionCats)) {
    for (const cat of cats) {
      const url = pickGif(cat, seed, salt++);
      if (url) { out[section] = url; break; }
    }
  }
  return out;
}

