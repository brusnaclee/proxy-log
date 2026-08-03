/**
 * Token statistics multiplier.
 *
 * Global base (env):
 *   - INPUT_TOKEN_MULTIPLIER
 *   - OUTPUT_TOKEN_MULTIPLIER
 *
 * Optional per-model pattern rules (admin_config.token_multiplier_rules JSON):
 *   [{ "pattern": "claude", "input": 3 }, { "pattern": "gpt", "input": 2 }]
 * First matching pattern wins (substring, case-insensitive). Omitted input/output
 * inherits the global env multiplier. Trial keys always use 1×.
 *
 * Applied at READ / gate time — raw request_logs columns stay unscaled.
 */

export type TokenMultiplierOpts = { isTrial?: boolean };

export type TokenMultiplierRule = {
  /** Substring matched against model id (case-insensitive), e.g. "claude", "gpt" */
  pattern: string;
  /** Override input multiplier; null/omit = inherit global */
  input?: number | null;
  /** Override output multiplier; null/omit = inherit global */
  output?: number | null;
};

/** Normalize a multiplier value: unset/invalid/<=0 -> 1. */
function normalizeMultiplier(raw: string | number | null | undefined): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return 1;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

let rulesCache: TokenMultiplierRule[] = [];

export function normalizeTokenMultiplierRules(raw: unknown): TokenMultiplierRule[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: TokenMultiplierRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const pattern = String((item as any).pattern || "").trim();
    if (!pattern) continue;
    const inputRaw = (item as any).input;
    const outputRaw = (item as any).output;
    const input =
      inputRaw === undefined || inputRaw === null || inputRaw === ""
        ? null
        : normalizeMultiplier(inputRaw);
    const output =
      outputRaw === undefined || outputRaw === null || outputRaw === ""
        ? null
        : normalizeMultiplier(outputRaw);
    out.push({ pattern, input, output });
  }
  return out;
}

export function serializeTokenMultiplierRules(rules: TokenMultiplierRule[]): string {
  return JSON.stringify(
    normalizeTokenMultiplierRules(rules).map((r) => ({
      pattern: r.pattern,
      ...(r.input != null ? { input: r.input } : {}),
      ...(r.output != null ? { output: r.output } : {}),
    })),
  );
}

export function setTokenMultiplierRulesCache(raw: unknown): void {
  rulesCache = normalizeTokenMultiplierRules(raw);
}

export function getTokenMultiplierRulesSync(): TokenMultiplierRule[] {
  return rulesCache;
}

export function getGlobalTokenMultipliers(): { input: number; output: number } {
  return {
    input: normalizeMultiplier(process.env.INPUT_TOKEN_MULTIPLIER),
    output: normalizeMultiplier(process.env.OUTPUT_TOKEN_MULTIPLIER),
  };
}

/** Resolve effective multipliers for a model id (pattern overrides → global). */
export function resolveTokenMultipliers(
  model?: string | null,
  opts?: TokenMultiplierOpts,
): { input: number; output: number } {
  if (opts?.isTrial) return { input: 1, output: 1 };
  const global = getGlobalTokenMultipliers();
  const lower = String(model || "").toLowerCase();
  if (!lower || !rulesCache.length) return global;

  for (const rule of rulesCache) {
    const pat = rule.pattern.toLowerCase();
    if (!pat) continue;
    if (lower.includes(pat)) {
      return {
        input: rule.input != null ? rule.input : global.input,
        output: rule.output != null ? rule.output : global.output,
      };
    }
  }
  return global;
}

/** @deprecated Prefer resolveTokenMultipliers(model) when model is known. */
export function getTokenMultipliers(opts?: TokenMultiplierOpts): { input: number; output: number } {
  return resolveTokenMultipliers(null, opts);
}

/**
 * SQL CASE expression (no outer parens required) for per-row input/output multipliers.
 * Uses substring match via position(lower(pattern) in lower(modelExpr)).
 */
export function sqlMultiplierExpr(
  kind: "input" | "output",
  modelExpr = "model",
  opts?: TokenMultiplierOpts,
): string {
  if (opts?.isTrial) return "1";
  const global = getGlobalTokenMultipliers();
  const fallback = kind === "input" ? global.input : global.output;
  if (!rulesCache.length) return String(fallback);

  const whens: string[] = [];
  for (const rule of rulesCache) {
    const pat = rule.pattern.toLowerCase().trim();
    if (!pat) continue;
    const mult =
      kind === "input"
        ? rule.input != null
          ? rule.input
          : global.input
        : rule.output != null
          ? rule.output
          : global.output;
    whens.push(
      `WHEN position('${escapeSqlLiteral(pat)}' in lower(COALESCE(${modelExpr}, ''))) > 0 THEN ${mult}`,
    );
  }
  if (!whens.length) return String(fallback);
  return `(CASE ${whens.join(" ")} ELSE ${fallback} END)`;
}

/**
 * Scale a breakdown row's token fields in place and return it.
 * Uses row.model when present so per-pattern rules apply.
 */
export function applyTokenMultiplier<T extends Record<string, any>>(row: T, opts?: TokenMultiplierOpts): T {
  const model = row.model ?? row.Model ?? null;
  const { input, output } = resolveTokenMultipliers(model, opts);
  if (input === 1 && output === 1) return row;

  if (typeof row.promptTokens === "number") {
    row.promptTokens = Math.round(row.promptTokens * input);
  }
  if (typeof row.completionTokens === "number") {
    row.completionTokens = Math.round(row.completionTokens * output);
  }
  if (typeof row.tokens === "number") {
    if (typeof row.promptTokens === "number" && typeof row.completionTokens === "number") {
      row.tokens = row.promptTokens + row.completionTokens;
    } else {
      row.tokens = Math.round(row.tokens * input);
    }
  }
  return row;
}

/** Scale an array of breakdown rows in place (per-row model when available). */
export function applyTokenMultiplierRows<T extends Record<string, any>>(rows: T[], opts?: TokenMultiplierOpts): T[] {
  return rows.map((r) => applyTokenMultiplier(r, opts));
}
