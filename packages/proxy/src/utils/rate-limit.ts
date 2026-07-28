import { db } from "../db/index.js";
import { requestLogs, modelLimits, apiKeys } from "../db/schema.js";
import { sql, and, eq, gte, inArray, type SQL } from "drizzle-orm";
import { stripProviderPrefix } from "./model-catalog.js";

function normalizeKeyIds(apiKeyId: number | number[]): number[] {
  const ids = (Array.isArray(apiKeyId) ? apiKeyId : [apiKeyId]).filter((id) => Number.isFinite(id) && id > 0);
  return ids.length > 0 ? ids : [0];
}

function keyIdMatch(apiKeyIds: number[]): SQL {
  if (apiKeyIds.length === 1) return eq(requestLogs.apiKeyId, apiKeyIds[0]);
  return inArray(requestLogs.apiKeyId, apiKeyIds);
}

/** Parse DB text timestamps (`YYYY-MM-DD HH:MM:SS` or ISO) to epoch ms. */
export function parseDbTimestampMs(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const ms = Date.parse(hasTz ? normalized : normalized + "Z");
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Fixed window from `*_window_start`: active until start+windowMs, then cliff to unused.
 * When inactive/expired, used counts as 0 until the next request opens a new start.
 */
export function resolveFixedWindow(
  fixedStartRaw: string | null | undefined,
  windowMs: number,
  nowMs = Date.now(),
): { active: boolean; windowStartMs: number; resetMs: number } {
  if (windowMs <= 0) return { active: false, windowStartMs: 0, resetMs: 0 };
  const windowStartMs = parseDbTimestampMs(fixedStartRaw);
  if (!windowStartMs) return { active: false, windowStartMs: 0, resetMs: 0 };
  if (nowMs >= windowStartMs + windowMs) {
    return { active: false, windowStartMs, resetMs: 0 };
  }
  return {
    active: true,
    windowStartMs,
    resetMs: Math.max(0, windowStartMs + windowMs - nowMs),
  };
}

async function loadKeyWindowStarts(apiKeyIds: number[]): Promise<{
  promptWindowStart: string | null;
  rateWindowStart: string | null;
}> {
  const row = await db
    .select({
      promptWindowStart: apiKeys.promptWindowStart,
      rateWindowStart: apiKeys.rateWindowStart,
    })
    .from(apiKeys)
    .where(inArray(apiKeys.id, apiKeyIds))
    .limit(1);
  return {
    promptWindowStart: row[0]?.promptWindowStart ?? null,
    rateWindowStart: row[0]?.rateWindowStart != null ? String(row[0].rateWindowStart) : null,
  };
}

/** Type alias for a model_limits row pulled from Drizzle. */
type ModelLimitRow = typeof modelLimits.$inferSelect;

/** True if the override row defines any enforceable limit (prompt and/or tokens). */
export function overrideHasLimits(m: ModelLimitRow): boolean {
  return (
    (m.promptLimit || 0) > 0 ||
    (m.dailyTokenLimit || 0) > 0 ||
    (m.monthlyTokenLimit || 0) > 0 ||
    (m.dailyInputTokenLimit || 0) > 0 ||
    (m.dailyOutputTokenLimit || 0) > 0
  );
}

export function parseRateLimitWindow(windowStr: string | null | undefined): number {
  if (!windowStr) return 0;
  const match = windowStr.trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  const value = parseInt(match[1]);
  const unit = match[2];
  if (isNaN(value)) return 0;
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

/**
 * Normalize model name for per-model limit matching.
 * Strips provider prefixes and extracts base model from auto patterns.
 *
 * Examples:
 *  - "auto (qwen-flash) [stream]"          -> "qwen-flash"
 *  - "auto (ag/gpt-oss-120b-medium)"       -> "gpt-oss-120b-medium"
 *  - "tokito/ag/claude-opus-4-6-thinking"  -> "claude-opus-4-6-thinking"
 *  - "ag/claude-opus-4-6-thinking"         -> "claude-opus-4-6-thinking"
 *  - "claude-opus-4-6-thinking"            -> "claude-opus-4-6-thinking"
 *  - "qwen-flash"                          -> "qwen-flash"
 */
export async function normalizeModelForLimit(model: string): Promise<string> {
  let normalized = model;

  // Step 1: Extract from auto pattern  "auto (X) [stream]" or "auto (X)"
  const autoMatch = normalized.match(/^auto\s*\(([^)]+)\)(?:\s*\[.*\])?\s*$/);
  if (autoMatch) {
    normalized = autoMatch[1].trim();
  }

  // Step 2: Strip provider prefix(es) iteratively
  // e.g. "tokito/ag/claude-opus-4-6-thinking" -> strip "tokito/" -> strip "ag/" -> "claude-opus-4-6-thinking"
  let prev = '';
  while (normalized !== prev) {
    prev = normalized;
    const stripped = await stripProviderPrefix(normalized);
    if (stripped !== normalized) {
      normalized = stripped;
    } else {
      break;
    }
  }

  return normalized;
}

/**
 * Build a SQL WHERE condition that matches request_logs rows whose model
 * normalizes to `normalizedModel`.  Handles:
 *   - exact:        model = 'X'
 *   - provider-pfx: model = 'tokito/ag/X'  (LIKE '%/X')
 *   - auto bare:    model = 'auto (X)' or 'auto (X) [stream]'
 *   - auto + pfx:   model = 'auto (ag/X)' or 'auto (ag/X) [stream]'
 */
export function getModelMatchCondition(normalizedModel: string): SQL {
  return sql`(
    ${requestLogs.model} = ${normalizedModel}
    OR ${requestLogs.model} LIKE ${'auto (' + normalizedModel + ')%'}
    OR ${requestLogs.model} LIKE ${'%/' + normalizedModel}
    OR ${requestLogs.model} LIKE ${'auto (%/' + normalizedModel + ')%'}
  )`;
}

/**
 * Slash-pattern variants for matching logged models.
 * `tokito/gcli/grok-4.5` → also `gcli/grok-4.5` (keeps ≥1 `/`).
 * Bare last segment (`grok-4.5`) is NOT included — too broad across providers.
 * Covers logs like `auto (gcli/grok-4.5)` when the rule stores the full catalog id.
 */
export function patternMatchVariants(pattern: string): string[] {
  const p = String(pattern || "").toLowerCase().trim();
  if (!p) return [];
  const out: string[] = [p];
  let rest = p;
  while (true) {
    const i = rest.indexOf("/");
    if (i < 0) break;
    rest = rest.slice(i + 1);
    if (!rest || !rest.includes("/")) break;
    out.push(rest);
  }
  return out;
}

/** Pattern family: count logged models containing the pattern (or slash-tail variants). */
export function getPatternModelMatchCondition(pattern: string): SQL {
  const variants = patternMatchVariants(pattern);
  if (!variants.length) return sql`false`;
  const parts = variants.map(
    (v) => sql`position(${v} in lower(${requestLogs.model})) > 0`,
  );
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/** Exact match against normalized runtime id OR catalog-style `provider/id`. */
function isExactModelLimit(m: ModelLimitRow, normalizedModel: string): boolean {
  if (m.isPattern) return false;
  const lower = normalizedModel.toLowerCase();
  const stored = (m.model || "").toLowerCase();
  if (!stored) return false;
  if (stored === lower) return true;
  if (stored.endsWith("/" + lower)) return true;
  if (lower.endsWith("/" + stored)) return true;
  const storedBase = stored.includes("/") ? stored.slice(stored.lastIndexOf("/") + 1) : stored;
  return storedBase === lower;
}

/**
 * Pattern match against normalized id and optional raw/catalog ids
 * (e.g. pattern `tokito/gcli/grok-4.5` must see the prefixed request model,
 * because normalizeModelForLimit strips provider prefixes).
 */
function isPatternModelLimit(
  m: ModelLimitRow,
  normalizedModel: string,
  matchModels?: string[] | null,
): boolean {
  if (!m.isPattern) return false;
  const pat = (m.model || "").toLowerCase().trim();
  if (!pat) return false;
  const variants = patternMatchVariants(pat);
  const haystacks = new Set<string>();
  haystacks.add(normalizedModel.toLowerCase());
  for (const extra of matchModels || []) {
    const e = String(extra || "").toLowerCase().trim();
    if (!e) continue;
    haystacks.add(e);
    // Also index auto-wrapper contents: "auto (gcli/grok-4.5) [stream]"
    const autoInner = e.match(/^auto\s*\(([^)]+)\)/i)?.[1]?.trim().toLowerCase();
    if (autoInner) haystacks.add(autoInner);
  }
  for (const h of haystacks) {
    for (const v of variants) {
      if (h.includes(v) || h.endsWith("/" + v)) return true;
    }
  }
  return false;
}

function pickLongestPattern(rows: ModelLimitRow[]): ModelLimitRow | undefined {
  if (!rows.length) return undefined;
  return [...rows].sort((a, b) => (b.model?.length || 0) - (a.model?.length || 0))[0];
}

function pickOverrideFromCandidates(
  candidates: ModelLimitRow[],
  normalizedModel: string,
  matchModels?: string[] | null,
): ModelLimitRow | null {
  const keyEx = candidates.find(
    (m) => m.scope === "key" && overrideHasLimits(m) && isExactModelLimit(m, normalizedModel),
  );
  if (keyEx) return keyEx;
  const keyPat = pickLongestPattern(
    candidates.filter(
      (m) =>
        m.scope === "key" &&
        overrideHasLimits(m) &&
        isPatternModelLimit(m, normalizedModel, matchModels),
    ),
  );
  if (keyPat) return keyPat;
  const gEx = candidates.find(
    (m) => m.scope === "global" && overrideHasLimits(m) && isExactModelLimit(m, normalizedModel),
  );
  if (gEx) return gEx;
  const gPat = pickLongestPattern(
    candidates.filter(
      (m) =>
        m.scope === "global" &&
        overrideHasLimits(m) &&
        isPatternModelLimit(m, normalizedModel, matchModels),
    ),
  );
  return gPat || null;
}

/**
 * Find the active model limit override for a (key, normalizedModel) pair.
 * Priority: keyExact > keyPattern (longest) > globalExact > globalPattern (longest).
 * Exact rows also match catalog IDs like `amanai/gpt-5.6-terra` vs bare `gpt-5.6-terra`.
 * @param matchModels optional raw/catalog ids for slash-containing patterns
 */
export async function findActiveOverride(
  apiKeyId: number,
  normalizedModel: string,
  matchModels?: string[] | null,
): Promise<ModelLimitRow | null> {
  const candidates = await db.select().from(modelLimits).where(
    sql`(${modelLimits.scope} = 'key' AND ${modelLimits.scopeId} = ${apiKeyId})
        OR (${modelLimits.scope} = 'global' AND ${modelLimits.scopeId} = 0)`
  );
  return pickOverrideFromCandidates(candidates, normalizedModel, matchModels);
}

/**
 * Transaction-aware variant of {@link findActiveOverride} for use inside
 * Drizzle transactions (e.g. the auto-routing block in proxy.ts).
 */
export async function findActiveOverrideInTx(
  tx: { select: typeof db.select },
  apiKeyId: number,
  normalizedModel: string,
  matchModels?: string[] | null,
): Promise<ModelLimitRow | null> {
  const candidates = await tx.select().from(modelLimits).where(
    sql`(${modelLimits.scope} = 'key' AND ${modelLimits.scopeId} = ${apiKeyId})
        OR (${modelLimits.scope} = 'global' AND ${modelLimits.scopeId} = 0)`
  );
  return pickOverrideFromCandidates(candidates, normalizedModel, matchModels);
}

/** Dedicated pool rule: usage excluded from account daily / daily input / daily output. */
export type DedicatedQuotaRule = {
  id: number;
  model: string;
  isPattern: boolean;
  scope: string;
  scopeId: number;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyInputTokenLimit: number;
  dailyOutputTokenLimit: number;
};

function rowIsDedicated(m: ModelLimitRow): boolean {
  return !!(m as ModelLimitRow & { dedicatedQuota?: boolean }).dedicatedQuota
    && (m.dailyTokenLimit || 0) > 0;
}

/** All dedicated-quota rules visible to a key (key-scoped + global). */
export async function listDedicatedQuotaRules(apiKeyId: number): Promise<DedicatedQuotaRule[]> {
  const rows = await db.select().from(modelLimits).where(
    sql`((${modelLimits.scope} = 'key' AND ${modelLimits.scopeId} = ${apiKeyId})
        OR (${modelLimits.scope} = 'global' AND ${modelLimits.scopeId} = 0))
        AND COALESCE(${modelLimits.dedicatedQuota}, false) = true
        AND COALESCE(${modelLimits.dailyTokenLimit}, 0) > 0`,
  );
  return rows.map((m) => ({
    id: m.id,
    model: m.model,
    isPattern: !!m.isPattern,
    scope: m.scope,
    scopeId: m.scopeId,
    dailyTokenLimit: m.dailyTokenLimit || 0,
    monthlyTokenLimit: m.monthlyTokenLimit || 0,
    dailyInputTokenLimit: m.dailyInputTokenLimit || 0,
    dailyOutputTokenLimit: m.dailyOutputTokenLimit || 0,
  }));
}

/** SQL fragment: model column matches a dedicated rule (exact family or substring pattern). */
export function sqlMatchDedicatedRule(rule: Pick<DedicatedQuotaRule, "model" | "isPattern">): SQL {
  if (rule.isPattern) {
    return getPatternModelMatchCondition(rule.model);
  }
  return getModelMatchCondition(rule.model);
}

/**
 * Exclude logs for models covered by any dedicated pool rule.
 * Returns undefined when there are no dedicated rules (no-op filter).
 */
export function sqlExcludeDedicatedModels(rules: DedicatedQuotaRule[]): SQL | undefined {
  if (!rules.length) return undefined;
  const parts = rules.map((r) => sqlMatchDedicatedRule(r));
  return sql`NOT (${sql.join(parts, sql` OR `)})`;
}

export function modelMatchesDedicatedRule(
  normalizedModel: string,
  rule: Pick<DedicatedQuotaRule, "model" | "isPattern">,
  matchModels?: string[] | null,
): boolean {
  const fake = {
    model: rule.model,
    isPattern: rule.isPattern,
  } as ModelLimitRow;
  return rule.isPattern
    ? isPatternModelLimit(fake, normalizedModel, matchModels)
    : isExactModelLimit(fake, normalizedModel);
}

/**
 * Pick the winning dedicated rule for a model (same priority as findActiveOverride,
 * but only among dedicated rows).
 */
export function findDedicatedRuleForModel(
  rules: DedicatedQuotaRule[],
  normalizedModel: string,
  matchModels?: string[] | null,
): DedicatedQuotaRule | null {
  if (!rules.length) return null;
  const asRows = rules.map((r) => ({
    ...r,
    promptLimit: 0,
    promptWindowStart: null,
    dedicatedQuota: true,
    createdAt: new Date(),
  })) as ModelLimitRow[];
  const picked = pickOverrideFromCandidates(asRows, normalizedModel, matchModels);
  if (!picked || !rowIsDedicated(picked)) return null;
  return {
    id: picked.id,
    model: picked.model,
    isPattern: !!picked.isPattern,
    scope: picked.scope,
    scopeId: picked.scopeId,
    dailyTokenLimit: picked.dailyTokenLimit || 0,
    monthlyTokenLimit: picked.monthlyTokenLimit || 0,
    dailyInputTokenLimit: picked.dailyInputTokenLimit || 0,
    dailyOutputTokenLimit: picked.dailyOutputTokenLimit || 0,
  };
}

/**
 * Count prompts as distinct turns (1 turn = 1 prompt) in a **fixed** window
 * that starts on the first request (`prompt_window_start`) and cliffs to 0
 * after windowMs (e.g. 50 / 5h → reset at start+5h, not sliding oldest+5h).
 */
export async function checkPromptLimit(
  apiKeyId: number | number[],
  promptLimit: number,
  windowStr: string,
  fixedWindowStart?: string | null,
): Promise<{ allowed: boolean; remaining: number; resetMs: number; used: number }> {
  if (promptLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };
  const windowMs = parseRateLimitWindow(windowStr);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };

  const apiKeyIds = normalizeKeyIds(apiKeyId);
  const nowMs = Date.now();
  let startRaw = fixedWindowStart;
  if (startRaw === undefined) {
    startRaw = (await loadKeyWindowStarts(apiKeyIds)).promptWindowStart;
  }
  const fixed = resolveFixedWindow(startRaw, windowMs, nowMs);
  if (!fixed.active) {
    return { allowed: true, remaining: promptLimit, resetMs: 0, used: 0 };
  }

  const windowStartDate = new Date(fixed.windowStartMs);
  const usage = await db.select({
    count: sql<number>`COUNT(DISTINCT ${requestLogs.turnId})`,
  })
    .from(requestLogs)
    .where(and(
      keyIdMatch(apiKeyIds),
      gte(requestLogs.createdAt, windowStartDate),
      sql`status_code BETWEEN 200 AND 299`,
      sql`turn_id IS NOT NULL`,
    ));

  const used = Number(usage[0]?.count) || 0;
  return {
    allowed: used < promptLimit,
    remaining: Math.max(0, promptLimit - used),
    resetMs: fixed.resetMs,
    used,
  };
}

/**
 * Count API calls (every successful upstream hop) in a **fixed** window from
 * `rate_window_start` (same cliff-reset semantics as prompts).
 */
export async function checkApiCallLimit(
  apiKeyId: number | number[],
  apiCallLimit: number,
  windowStr: string,
  fixedWindowStart?: string | null,
): Promise<{ allowed: boolean; remaining: number; resetMs: number; used: number }> {
  if (apiCallLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };
  const windowMs = parseRateLimitWindow(windowStr);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };

  const apiKeyIds = normalizeKeyIds(apiKeyId);
  const nowMs = Date.now();
  let startRaw = fixedWindowStart;
  if (startRaw === undefined) {
    startRaw = (await loadKeyWindowStarts(apiKeyIds)).rateWindowStart;
  }
  const fixed = resolveFixedWindow(startRaw, windowMs, nowMs);
  if (!fixed.active) {
    return { allowed: true, remaining: apiCallLimit, resetMs: 0, used: 0 };
  }

  const windowStartDate = new Date(fixed.windowStartMs);
  const usage = await db.select({
    count: sql<number>`count(*)`,
  })
    .from(requestLogs)
    .where(and(
      keyIdMatch(apiKeyIds),
      gte(requestLogs.createdAt, windowStartDate),
      sql`status_code BETWEEN 200 AND 299`,
    ));

  const used = Number(usage[0]?.count) || 0;
  return {
    allowed: used < apiCallLimit,
    remaining: Math.max(0, apiCallLimit - used),
    resetMs: fixed.resetMs,
    used,
  };
}

export async function getApiCallWindowResetMs(
  apiKeyId: number | number[],
  windowMs: number,
  fixedWindowStart?: string | null,
): Promise<number> {
  if (windowMs <= 0) return 0;
  const apiKeyIds = normalizeKeyIds(apiKeyId);
  let startRaw = fixedWindowStart;
  if (startRaw === undefined) {
    startRaw = (await loadKeyWindowStarts(apiKeyIds)).rateWindowStart;
  }
  return resolveFixedWindow(startRaw, windowMs).resetMs;
}

export type CheckModelPromptLimitOpts = {
  /** Fallback when no override/default applies (e.g. non-addon Claude/GPT-5.6 tease = 3). */
  teaseDefaultLimit?: number;
};

/**
 * Check per-model prompt limit for an API key (or Discord account key set).
 * Pattern overrides count the whole family (substring match on logged model ids).
 */
export async function checkModelPromptLimit(
  apiKeyId: number | number[],
  model: string,
  perKeyDefaultLimit: number,
  perKeyDefaultWindow: string | null,
  globalDefaultLimit: number,
  globalDefaultWindow: string,
  opts?: CheckModelPromptLimitOpts,
): Promise<{
  allowed: boolean;
  remaining: number;
  resetMs: number;
  used: number;
  effectiveLimit: number;
  source: "override" | "key_default" | "global_default" | "tease_default" | "none";
  overrideModel?: string;
  overrideIsPattern?: boolean;
}> {
  const apiKeyIds = normalizeKeyIds(apiKeyId);
  const overrideKeyId = apiKeyIds[0];

  // Normalize model name so "tokito/ag/claude-opus-4-6" matches "ag/claude-opus-4-6" etc.
  const normalizedModel = await normalizeModelForLimit(model);

  // Resolve the highest-priority override (key exact > key pattern > global exact > global pattern).
  const activeOverride = await findActiveOverride(overrideKeyId, normalizedModel);

  let effectiveLimit = 0;
  let source: "override" | "key_default" | "global_default" | "tease_default" | "none" = "none";

  if (activeOverride && activeOverride.promptLimit > 0) {
    effectiveLimit = activeOverride.promptLimit;
    source = "override";
  } else if (perKeyDefaultLimit > 0) {
    effectiveLimit = perKeyDefaultLimit;
    source = "key_default";
  } else if (globalDefaultLimit > 0) {
    effectiveLimit = globalDefaultLimit;
    source = "global_default";
  } else if ((opts?.teaseDefaultLimit || 0) > 0) {
    effectiveLimit = opts!.teaseDefaultLimit!;
    source = "tease_default";
  }

  if (effectiveLimit <= 0) {
    return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit: 0, source: "none" };
  }

  const effectiveWindow = perKeyDefaultWindow || globalDefaultWindow || "1d";
  const windowMs = parseRateLimitWindow(effectiveWindow);
  if (windowMs <= 0) {
    return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit, source };
  }

  const nowMs = Date.now();
  const modelMatch =
    activeOverride?.isPattern && activeOverride.model
      ? getPatternModelMatchCondition(activeOverride.model)
      : getModelMatchCondition(normalizedModel);

  // Per-model override rows store prompt_window_start → fixed cliff window.
  // Defaults without a stored start fall back to sliding last-N (rare path).
  let windowStartDate: Date;
  let resetMs = windowMs;
  if (source === "override" && activeOverride) {
    const fixed = resolveFixedWindow(activeOverride.promptWindowStart, windowMs, nowMs);
    if (!fixed.active) {
      return {
        allowed: true,
        remaining: effectiveLimit,
        resetMs: 0,
        used: 0,
        effectiveLimit,
        source,
        overrideModel: activeOverride.model,
        overrideIsPattern: !!activeOverride.isPattern,
      };
    }
    windowStartDate = new Date(fixed.windowStartMs);
    resetMs = fixed.resetMs;
  } else {
    windowStartDate = new Date(nowMs - windowMs);
  }

  const usage = await db.select({
    count: sql<number>`COUNT(DISTINCT ${requestLogs.turnId})`,
    oldest: sql<string | null>`MIN(${requestLogs.createdAt})`,
  })
    .from(requestLogs)
    .where(and(
      keyIdMatch(apiKeyIds),
      modelMatch,
      gte(requestLogs.createdAt, windowStartDate),
      sql`status_code BETWEEN 200 AND 299`,
      sql`turn_id IS NOT NULL`,
    ));

  const used = Number(usage[0]?.count) || 0;
  if (source !== "override") {
    const oldestRaw = usage[0]?.oldest;
    if (oldestRaw) {
      const oldestMs = parseDbTimestampMs(String(oldestRaw));
      if (oldestMs) resetMs = Math.max(0, oldestMs + windowMs - nowMs);
    }
  }

  return {
    allowed: used < effectiveLimit,
    remaining: Math.max(0, effectiveLimit - used),
    resetMs,
    used,
    effectiveLimit,
    source,
    overrideModel: activeOverride?.model,
    overrideIsPattern: activeOverride ? !!activeOverride.isPattern : undefined,
  };
}

/**
 * Ms until fixed prompt window cliffs (from prompt_window_start), or model override start.
 */
export async function getWindowResetMs(apiKeyId: number | number[], windowMs: number, model?: string): Promise<number> {
  if (windowMs <= 0) return 0;

  const nowMs = Date.now();
  const apiKeyIds = normalizeKeyIds(apiKeyId);

  if (model) {
    const normalizedModel = await normalizeModelForLimit(model);
    const activeOverride = await findActiveOverride(apiKeyIds[0], normalizedModel);
    if (activeOverride?.promptWindowStart) {
      return resolveFixedWindow(activeOverride.promptWindowStart, windowMs, nowMs).resetMs;
    }
    const windowStartDate = new Date(nowMs - windowMs);
    const modelMatch =
      activeOverride?.isPattern && activeOverride.model
        ? getPatternModelMatchCondition(activeOverride.model)
        : getModelMatchCondition(normalizedModel);

    const row = await db.select({
      oldest: sql<string | null>`MIN(${requestLogs.createdAt})`,
    })
      .from(requestLogs)
      .where(and(
        keyIdMatch(apiKeyIds),
        modelMatch,
        gte(requestLogs.createdAt, windowStartDate),
        sql`status_code BETWEEN 200 AND 299`,
        sql`turn_id IS NOT NULL`,
      ));
    const oldestRaw = row[0]?.oldest;
    if (!oldestRaw) return 0;
    const oldestMs = parseDbTimestampMs(String(oldestRaw));
    if (!oldestMs) return 0;
    return Math.max(0, oldestMs + windowMs - nowMs);
  }

  const startRaw = (await loadKeyWindowStarts(apiKeyIds)).promptWindowStart;
  return resolveFixedWindow(startRaw, windowMs, nowMs).resetMs;
}
