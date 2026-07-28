/**
 * Token Saver intensity: preset | custom resolution + confirm zones.
 * Shared by proxy resolve, admin/portal APIs, and copy hints.
 */

export type IntensityMode = "preset" | "custom";

export type LiteBalancedAggressive = "lite" | "balanced" | "aggressive";

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function parseJsonObj(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object" && !Array.isArray(j)) return j;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function normalizeMode(raw: unknown): IntensityMode {
  return String(raw || "preset").toLowerCase() === "custom" ? "custom" : "preset";
}

export function normalizeLba(raw: unknown, fallback: LiteBalancedAggressive = "balanced"): LiteBalancedAggressive {
  const l = String(raw || fallback).toLowerCase();
  if (l === "lite" || l === "balanced" || l === "aggressive") return l;
  return fallback;
}

// ─── Anti-Waste ───────────────────────────────────────────────────────────────

export type AntiWasteThresholds = {
  nudgeAt: number;
  dedupeAt: number;
  shortCircuitAt: number;
};

const ANTI_WASTE_PRESETS: Record<LiteBalancedAggressive, AntiWasteThresholds> = {
  lite: { nudgeAt: 3, dedupeAt: 5, shortCircuitAt: 12 },
  balanced: { nudgeAt: 3, dedupeAt: 4, shortCircuitAt: 8 },
  aggressive: { nudgeAt: 2, dedupeAt: 3, shortCircuitAt: 5 },
};

export function resolveAntiWasteThresholds(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): AntiWasteThresholds {
  if (mode === "custom") {
    const c = parseJsonObj(customRaw);
    let nudgeAt = clamp(Number(c.nudgeAt) || 3, 1, 20);
    let dedupeAt = clamp(Number(c.dedupeAt) || 4, 1, 30);
    let shortCircuitAt = clamp(Number(c.shortCircuitAt) || 8, 2, 50);
    if (dedupeAt < nudgeAt) dedupeAt = nudgeAt;
    if (shortCircuitAt < dedupeAt) shortCircuitAt = dedupeAt;
    return { nudgeAt, dedupeAt, shortCircuitAt };
  }
  return { ...ANTI_WASTE_PRESETS[preset] };
}

export function antiWasteNeedsConfirm(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): boolean {
  if (mode === "preset") return preset === "aggressive";
  const t = resolveAntiWasteThresholds("custom", "balanced", customRaw);
  return t.shortCircuitAt < 6;
}

// ─── Groupy Compact ───────────────────────────────────────────────────────────

export type CompactParams = {
  recentKeep: number;
  minChars: number;
  assistantProseMax: number;
  levelLabel: LiteBalancedAggressive;
};

const COMPACT_PRESETS: Record<LiteBalancedAggressive, Omit<CompactParams, "levelLabel">> = {
  lite: { recentKeep: 4, minChars: 4000, assistantProseMax: 0 },
  balanced: { recentKeep: 3, minChars: 1500, assistantProseMax: 0 },
  aggressive: { recentKeep: 2, minChars: 400, assistantProseMax: 8000 },
};

export function resolveCompactParams(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): CompactParams {
  if (mode === "custom") {
    const c = parseJsonObj(customRaw);
    const recentKeep = clamp(Number(c.keepLastN ?? c.recentKeep) || 3, 1, 10);
    const minChars = clamp(Number(c.stubMinChars ?? c.minChars) || 1500, 200, 20000);
    const trim = c.trimAssistantProse === true || c.trimAssistantProse === "true";
    const assistantProseMax = trim
      ? clamp(Number(c.assistantProseMax) || 8000, 1000, 50000)
      : 0;
    return { recentKeep, minChars, assistantProseMax, levelLabel: "balanced" };
  }
  return { ...COMPACT_PRESETS[preset], levelLabel: preset };
}

export function compactNeedsConfirm(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): boolean {
  if (mode === "preset") return preset === "aggressive";
  const p = resolveCompactParams("custom", "balanced", customRaw);
  return p.recentKeep <= 2 || p.minChars < 600;
}

// ─── Soft Batch ───────────────────────────────────────────────────────────────

export type BatchParams = { strength: number; levelLabel: LiteBalancedAggressive };

const BATCH_PRESETS: Record<LiteBalancedAggressive, number> = {
  lite: 1,
  balanced: 3,
  aggressive: 5,
};

export function resolveBatchParams(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): BatchParams {
  if (mode === "custom") {
    const c = parseJsonObj(customRaw);
    return {
      strength: clamp(Number(c.strength) || 3, 1, 5),
      levelLabel: "balanced",
    };
  }
  return { strength: BATCH_PRESETS[preset], levelLabel: preset };
}

export function batchNeedsConfirm(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): boolean {
  if (mode === "preset") return preset === "aggressive";
  return resolveBatchParams("custom", "balanced", customRaw).strength >= 4;
}

// ─── RTK ──────────────────────────────────────────────────────────────────────

export type RtkParams = { maxChars: number; levelLabel: LiteBalancedAggressive };

const RTK_PRESETS: Record<LiteBalancedAggressive, number> = {
  lite: 4000,
  balanced: 2000,
  aggressive: 800,
};

export function resolveRtkParams(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
  /** Legacy admin maxChars when mode=preset balanced or migrating */
  legacyMaxChars?: number | null,
): RtkParams {
  if (mode === "custom") {
    const c = parseJsonObj(customRaw);
    const fromCustom = Number(c.maxChars);
    const maxChars = clamp(
      Number.isFinite(fromCustom) && fromCustom > 0
        ? fromCustom
        : Number(legacyMaxChars) || 2000,
      200,
      50000,
    );
    return { maxChars, levelLabel: "balanced" };
  }
  // If balanced and legacy maxChars was customized, prefer it
  if (preset === "balanced" && legacyMaxChars != null && Number(legacyMaxChars) > 0) {
    const n = Number(legacyMaxChars);
    if (n !== 2000) return { maxChars: clamp(n, 200, 50000), levelLabel: "balanced" };
  }
  return { maxChars: RTK_PRESETS[preset], levelLabel: preset };
}

export function rtkNeedsConfirm(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
  legacyMaxChars?: number | null,
): boolean {
  if (mode === "preset") return preset === "aggressive";
  return resolveRtkParams("custom", "balanced", customRaw, legacyMaxChars).maxChars < 1000;
}

// ─── Headroom ─────────────────────────────────────────────────────────────────

export type HeadroomParams = { timeoutMs: number; levelLabel: LiteBalancedAggressive };

const HEADROOM_PRESETS: Record<LiteBalancedAggressive, number> = {
  lite: 5000,
  balanced: 3000,
  aggressive: 1000,
};

export function resolveHeadroomParams(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): HeadroomParams {
  if (mode === "custom") {
    const c = parseJsonObj(customRaw);
    return {
      timeoutMs: clamp(Number(c.timeoutMs) || 3000, 500, 10000),
      levelLabel: "balanced",
    };
  }
  return { timeoutMs: HEADROOM_PRESETS[preset], levelLabel: preset };
}

export function headroomNeedsConfirm(
  mode: IntensityMode,
  preset: LiteBalancedAggressive,
  customRaw: unknown,
): boolean {
  if (mode === "preset") return preset === "aggressive";
  return resolveHeadroomParams("custom", "balanced", customRaw).timeoutMs < 1500;
}

// ─── Caveman ──────────────────────────────────────────────────────────────────

export type CavemanParams = { level: number };

export function resolveCavemanParams(
  mode: IntensityMode,
  presetLevel: number | string | null | undefined,
  customRaw: unknown,
): CavemanParams {
  if (mode === "custom") {
    const c = parseJsonObj(customRaw);
    return { level: clamp(Number(c.level ?? presetLevel) || 2, 1, 5) };
  }
  return { level: clamp(Number(presetLevel) || 2, 1, 5) };
}

export function cavemanNeedsConfirm(mode: IntensityMode, level: number): boolean {
  return level >= 4;
}

// ─── Ponytail ─────────────────────────────────────────────────────────────────

export type PonytailLevel = "lite" | "full" | "ultra";

export type PonytailParams = { level: PonytailLevel };

export function normalizePonytailLevel(raw: unknown): PonytailLevel {
  const l = String(raw || "lite").toLowerCase();
  if (l === "lite" || l === "full" || l === "ultra") return l;
  const n = Number(raw);
  if (n === 1) return "lite";
  if (n === 2) return "full";
  if (n === 3) return "ultra";
  return "lite";
}

export function resolvePonytailParams(
  mode: IntensityMode,
  preset: unknown,
  customRaw: unknown,
): PonytailParams {
  if (mode === "custom") {
    const c = parseJsonObj(customRaw);
    if (c.strength != null) {
      const s = clamp(Number(c.strength) || 1, 1, 3);
      return { level: s === 1 ? "lite" : s === 2 ? "full" : "ultra" };
    }
    return { level: normalizePonytailLevel(c.level ?? preset) };
  }
  return { level: normalizePonytailLevel(preset) };
}

export function ponytailNeedsConfirm(level: PonytailLevel): boolean {
  return level === "ultra";
}

export function stringifyCustom(obj: Record<string, unknown> | null | undefined): string {
  try {
    return JSON.stringify(obj && typeof obj === "object" ? obj : {});
  } catch {
    return "{}";
  }
}
