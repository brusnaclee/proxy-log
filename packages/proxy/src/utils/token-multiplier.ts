/**
 * Token statistics multiplier.
 *
 * Allows scaling input/output token counts (and derived costs) for all
 * statistics/aggregations at READ time, via environment variables:
 *   - INPUT_TOKEN_MULTIPLIER   (applies to prompt / input tokens)
 *   - OUTPUT_TOKEN_MULTIPLIER  (applies to completion / output tokens)
 *
 * Rules:
 *   - Unset / empty / non-numeric / <= 0  -> 1 (neutral, no change)
 *   - Any positive number                 -> used as-is (e.g. 2 = 2x)
 *
 * Because this is applied at read time, raw stored columns are never mutated.
 * Changing the env back to 1 (or unsetting it) restores original numbers.
 *
 * Trial API keys always use 1× (raw upstream counts) — multipliers never apply.
 */

export type TokenMultiplierOpts = { isTrial?: boolean };

/** Normalize an env multiplier value: unset/invalid/<=0 -> 1. */
function normalizeMultiplier(raw: string | undefined): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return 1;
  const n = parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

/** Read the current input/output token multipliers from the environment. */
export function getTokenMultipliers(opts?: TokenMultiplierOpts): { input: number; output: number } {
  if (opts?.isTrial) return { input: 1, output: 1 };
  return {
    input: normalizeMultiplier(process.env.INPUT_TOKEN_MULTIPLIER),
    output: normalizeMultiplier(process.env.OUTPUT_TOKEN_MULTIPLIER),
  };
}

/**
 * Scale a breakdown row's token fields in place and return it.
 * Expects numeric `promptTokens` / `completionTokens` (already sanitized).
 * Recomputes `tokens` as the scaled sum when the field exists.
 */
export function applyTokenMultiplier<T extends Record<string, any>>(row: T, opts?: TokenMultiplierOpts): T {
  const { input, output } = getTokenMultipliers(opts);
  if (input === 1 && output === 1) return row;

  if (typeof row.promptTokens === "number") {
    row.promptTokens = Math.round(row.promptTokens * input);
  }
  if (typeof row.completionTokens === "number") {
    row.completionTokens = Math.round(row.completionTokens * output);
  }
  if (typeof row.tokens === "number") {
    // Prefer recomputing from the scaled split when both parts are present.
    if (typeof row.promptTokens === "number" && typeof row.completionTokens === "number") {
      row.tokens = row.promptTokens + row.completionTokens;
    } else {
      // Fallback: no split available, scale by input multiplier as a best effort.
      row.tokens = Math.round(row.tokens * input);
    }
  }
  return row;
}

/** Scale an array of breakdown rows in place. */
export function applyTokenMultiplierRows<T extends Record<string, any>>(rows: T[], opts?: TokenMultiplierOpts): T[] {
  return rows.map((r) => applyTokenMultiplier(r, opts));
}
