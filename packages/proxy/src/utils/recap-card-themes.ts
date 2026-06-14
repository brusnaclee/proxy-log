/**
 * 100 overlay themes for the shareable recap card. The wallpaper itself is a
 * live anime GIF (resolved at generate time), and the theme tints the scrim,
 * sets the stat-number gradient, glass fill opacity, and which of the 5 stored
 * wallpaper candidates is active. This gives 100 distinct looks × 5 wallpapers
 * of variation while keeping the file small.
 */

export interface CardTheme {
  id: number;
  family: string;
  name: string;
  /** RGBA scrim color overlaid on the wallpaper for legibility. */
  scrim: string;
  /** Solid bottom-heavy scrim end color. */
  scrimEnd: string;
  /** Gradient stops for the big stat numbers. */
  accentA: string;
  accentB: string;
  /** Glass fill rgba (0..1 alpha). */
  glassAlpha: number;
  /** Glass border rgba. */
  glassBorder: string;
  /** Body text color. */
  text: string;
  /** Muted text color. */
  muted: string;
  /** Index into the user's stored wallpapers array (0..4). */
  wallpaperIndex: number;
  /** Optional CSS hue-rotate filter (deg) applied to the wallpaper img. */
  hueRotate?: number;
  /** Optional saturation multiplier (1 = neutral, 0 = grayscale, 1.5 = boosted). */
  saturate?: number;
  /** Optional brightness (1 = neutral). */
  brightness?: number;
}

const FAMILIES: { name: string; scrim: string; scrimEnd: string; text: string; muted: string; palettes: Array<[string, string, string]> }[] = [
  {
    name: "Sakura",
    scrim: "rgba(20,8,30,0.15)", scrimEnd: "rgba(20,8,30,0.85)", text: "#fff", muted: "rgba(255,255,255,.78)",
    palettes: [
      ["#fda4af", "#f472b6", "Sakura"],
      ["#fbcfe8", "#ec4899", "Cherry"],
      ["#fecdd3", "#fb7185", "Hanami"],
      ["#ffd6e0", "#db2777", "Sakura Bloom"],
      ["#f9a8d4", "#be185d", "Plum"],
    ],
  },
  {
    name: "Neon Tokyo",
    scrim: "rgba(10,0,40,0.15)", scrimEnd: "rgba(10,0,40,0.85)", text: "#fff", muted: "rgba(220,230,255,.78)",
    palettes: [
      ["#22d3ee", "#a855f7", "Akihabara"],
      ["#06b6d4", "#7c3aed", "Shibuya"],
      ["#3b82f6", "#ec4899", "Rainbow"],
      ["#0ea5e9", "#8b5cf6", "Shinjuku"],
      ["#22d3ee", "#f472b6", "Kawaii"],
      ["#a78bfa", "#22d3ee", "Vapor"],
    ],
  },
  {
    name: "Sunset",
    scrim: "rgba(40,10,20,0.15)", scrimEnd: "rgba(40,10,20,0.88)", text: "#fff", muted: "rgba(255,225,210,.78)",
    palettes: [
      ["#fb923c", "#ef4444", "Ember"],
      ["#f59e0b", "#f43f5e", "Dusk"],
      ["#fbbf24", "#dc2626", "Coral"],
      ["#fdba74", "#db2777", "Peach"],
      ["#fcd34d", "#c026d3", "Magma"],
    ],
  },
  {
    name: "Forest",
    scrim: "rgba(5,20,15,0.15)", scrimEnd: "rgba(5,20,15,0.88)", text: "#fff", muted: "rgba(220,255,235,.78)",
    palettes: [
      ["#22c55e", "#0ea5e9", "Moss"],
      ["#10b981", "#14b8a6", "Glade"],
      ["#84cc16", "#22c55e", "Verdant"],
      ["#34d399", "#06b6d4", "Mint"],
      ["#a3e635", "#0d9488", "Sage"],
    ],
  },
  {
    name: "Ocean",
    scrim: "rgba(0,10,30,0.15)", scrimEnd: "rgba(0,10,30,0.9)", text: "#fff", muted: "rgba(200,225,255,.78)",
    palettes: [
      ["#0ea5e9", "#3b82f6", "Deep"],
      ["#22d3ee", "#6366f1", "Reef"],
      ["#38bdf8", "#0d9488", "Tide"],
      ["#67e8f9", "#2563eb", "Pacific"],
      ["#06b6d4", "#4f46e5", "Abyss"],
    ],
  },
  {
    name: "Royal",
    scrim: "rgba(15,5,40,0.15)", scrimEnd: "rgba(15,5,40,0.9)", text: "#fff", muted: "rgba(225,210,255,.78)",
    palettes: [
      ["#a855f7", "#f59e0b", "Majesty"],
      ["#7c3aed", "#facc15", "Crown"],
      ["#8b5cf6", "#fb7185", "Velvet"],
      ["#c084fc", "#22d3ee", "Monarch"],
      ["#d946ef", "#f59e0b", "Dynasty"],
    ],
  },
  {
    name: "Mono",
    scrim: "rgba(0,0,0,0.25)", scrimEnd: "rgba(0,0,0,0.92)", text: "#fff", muted: "rgba(255,255,255,.7)",
    palettes: [
      ["#ffffff", "#a1a1aa", "Mono"],
      ["#f5f5f4", "#71717a", "Paper"],
      ["#e5e5e5", "#52525b", "Slate"],
      ["#fafafa", "#3f3f46", "Ink"],
      ["#d4d4d8", "#27272a", "Noir"],
    ],
  },
  {
    name: "Solar",
    scrim: "rgba(40,20,0,0.15)", scrimEnd: "rgba(40,20,0,0.88)", text: "#fff", muted: "rgba(255,235,200,.78)",
    palettes: [
      ["#facc15", "#f97316", "Solar"],
      ["#fbbf24", "#dc2626", "Flare"],
      ["#fde047", "#ea580c", "Sunspot"],
      ["#f59e0b", "#7c2d12", "Ember"],
      ["#eab308", "#b91c1c", "Corona"],
    ],
  },
  {
    name: "Aurora",
    scrim: "rgba(0,20,30,0.15)", scrimEnd: "rgba(0,20,30,0.9)", text: "#fff", muted: "rgba(200,255,235,.78)",
    palettes: [
      ["#10b981", "#3b82f6", "Boreal"],
      ["#22d3ee", "#a855f7", "Borealis"],
      ["#14b8a6", "#8b5cf6", "Tundra"],
      ["#34d399", "#6366f1", "Polaris"],
      ["#06b6d4", "#c084fc", "Nimbus"],
    ],
  },
  {
    name: "Cotton",
    scrim: "rgba(40,30,30,0.12)", scrimEnd: "rgba(40,30,30,0.85)", text: "#fff", muted: "rgba(255,235,235,.78)",
    palettes: [
      ["#fda4af", "#fdba74", "Cotton"],
      ["#fbcfe8", "#fde68a", "Marshmallow"],
      ["#fed7aa", "#fda4af", "Sorbet"],
      ["#fef08a", "#fb7185", "Butterscotch"],
      ["#f9a8d4", "#fcd34d", "Taffy"],
    ],
  },
  {
    name: "Frost",
    scrim: "rgba(0,10,25,0.15)", scrimEnd: "rgba(0,10,25,0.92)", text: "#fff", muted: "rgba(220,240,255,.78)",
    palettes: [
      ["#7dd3fc", "#a78bfa", "Glacier"],
      ["#67e8f9", "#818cf8", "Crystal"],
      ["#bae6fd", "#c4b5fd", "Iceberg"],
      ["#93c5fd", "#a5b4fc", "Permafrost"],
      ["#22d3ee", "#c084fc", "Hailstorm"],
    ],
  },
  {
    name: "Lava",
    scrim: "rgba(20,5,0,0.15)", scrimEnd: "rgba(20,5,0,0.92)", text: "#fff", muted: "rgba(255,210,200,.78)",
    palettes: [
      ["#f97316", "#dc2626", "Lava"],
      ["#ef4444", "#7c2d12", "Volcano"],
      ["#fb7185", "#9a3412", "Magma"],
      ["#fb923c", "#450a0a", "Pyre"],
      ["#f87171", "#1c1917", "Obsidian"],
    ],
  },
  {
    name: "Mint",
    scrim: "rgba(0,20,15,0.15)", scrimEnd: "rgba(0,20,15,0.88)", text: "#fff", muted: "rgba(210,255,235,.78)",
    palettes: [
      ["#6ee7b7", "#22d3ee", "Mint"],
      ["#a7f3d0", "#67e8f9", "Sprout"],
      ["#5eead4", "#93c5fd", "Verde"],
      ["#86efac", "#7dd3fc", "Spearmint"],
      ["#4ade80", "#22d3ee", "Matcha"],
    ],
  },
  {
    name: "Cyber",
    scrim: "rgba(0,0,15,0.2)", scrimEnd: "rgba(0,0,15,0.92)", text: "#fff", muted: "rgba(200,255,255,.78)",
    palettes: [
      ["#22d3ee", "#f0abfc", "Cyber"],
      ["#67e8f9", "#fbbf24", "Synthwave"],
      ["#a78bfa", "#34d399", "Glitch"],
      ["#f472b6", "#22d3ee", "Hologram"],
      ["#7c3aed", "#22d3ee", "Retrowave"],
    ],
  },
  {
    name: "Honey",
    scrim: "rgba(30,15,0,0.15)", scrimEnd: "rgba(30,15,0,0.88)", text: "#fff", muted: "rgba(255,235,180,.78)",
    palettes: [
      ["#fbbf24", "#b45309", "Honey"],
      ["#fcd34d", "#92400e", "Amber"],
      ["#fde68a", "#a16207", "Goldenrod"],
      ["#facc15", "#7c2d12", "Wheat"],
      ["#f59e0b", "#451a03", "Toffee"],
    ],
  },
  {
    name: "Berry",
    scrim: "rgba(20,5,25,0.15)", scrimEnd: "rgba(20,5,25,0.9)", text: "#fff", muted: "rgba(255,210,240,.78)",
    palettes: [
      ["#ec4899", "#7c3aed", "Berry"],
      ["#f472b6", "#3b82f6", "Mulberry"],
      ["#db2777", "#1d4ed8", "Cassis"],
      ["#e879f9", "#7c3aed", "Lychee"],
      ["#f9a8d4", "#6366f1", "Pomegranate"],
    ],
  },
  {
    name: "Storm",
    scrim: "rgba(0,0,10,0.25)", scrimEnd: "rgba(0,0,10,0.95)", text: "#fff", muted: "rgba(200,210,225,.78)",
    palettes: [
      ["#94a3b8", "#475569", "Storm"],
      ["#cbd5e1", "#334155", "Thunder"],
      ["#e2e8f0", "#1e293b", "Lightning"],
      ["#f1f5f9", "#0f172a", "Squall"],
      ["#cbd5e1", "#1e3a8a", "Tempest"],
    ],
  },
  {
    name: "Spring",
    scrim: "rgba(10,25,5,0.12)", scrimEnd: "rgba(10,25,5,0.85)", text: "#fff", muted: "rgba(220,255,220,.78)",
    palettes: [
      ["#86efac", "#fde68a", "Spring"],
      ["#a7f3d0", "#fbcfe8", "Meadow"],
      ["#bef264", "#67e8f9", "Bloom"],
      ["#fde68a", "#a3e635", "Daffodil"],
      ["#f9a8d4", "#86efac", "Petal"],
    ],
  },
  {
    name: "Cosmic",
    scrim: "rgba(10,0,25,0.25)", scrimEnd: "rgba(10,0,25,0.95)", text: "#fff", muted: "rgba(225,210,255,.78)",
    palettes: [
      ["#a78bfa", "#f0abfc", "Cosmic"],
      ["#7c3aed", "#06b6d4", "Nebula"],
      ["#c084fc", "#fbbf24", "Galaxy"],
      ["#8b5cf6", "#22d3ee", "Pulsar"],
      ["#d946ef", "#3b82f6", "Quasar"],
    ],
  },
  {
    name: "Inferno",
    scrim: "rgba(25,5,0,0.18)", scrimEnd: "rgba(25,5,0,0.92)", text: "#fff", muted: "rgba(255,200,180,.78)",
    palettes: [
      ["#dc2626", "#7c2d12", "Inferno"],
      ["#f87171", "#fbbf24", "Hellfire"],
      ["#ef4444", "#1c1917", "Demon"],
      ["#fb923c", "#450a0a", "Wildfire"],
      ["#b91c1c", "#facc15", "Brimstone"],
    ],
  },
];

export const CARD_THEMES: CardTheme[] = (() => {
  const out: CardTheme[] = [];
  let id = 0;
  for (const fam of FAMILIES) {
    for (const p of fam.palettes) {
      out.push({
        id: id++,
        family: fam.name,
        name: p[2],
        scrim: fam.scrim,
        scrimEnd: fam.scrimEnd,
        accentA: p[0],
        accentB: p[1],
        glassAlpha: 0.14,
        glassBorder: "rgba(255,255,255,0.28)",
        text: fam.text,
        muted: fam.muted,
        wallpaperIndex: id % 5,
        saturate: 1.05,
        brightness: 0.95,
      });
      if (out.length >= 100) break;
    }
    if (out.length >= 100) break;
  }
  return out;
})();

export const CARD_THEME_COUNT = CARD_THEMES.length;
