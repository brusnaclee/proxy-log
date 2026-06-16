import { db } from "../db/index.js";
import { requestLogs, modelLimits, apiKeys } from "../db/schema.js";
import { sql, and, eq, gte, type SQL } from "drizzle-orm";
import { COUNTED_LOG_SQL } from "./counting.js";
import { stripProviderPrefix } from "./model-catalog.js";

/** Type alias for a model_limits row pulled from Drizzle. */
type ModelLimitRow = typeof modelLimits.$inferSelect;

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
 * Find the active model limit override for a (key, normalizedModel) pair.
 * Priority: keyExact > keyPattern > globalExact > globalPattern.
 * Returns null if no override applies (caller falls back to per-key default,
 * then global default).
 */
export async function findActiveOverride(
  apiKeyId: number,
  normalizedModel: string,
): Promise<ModelLimitRow | null> {
  const lower = normalizedModel.toLowerCase();
  // Pull all key + global overrides once, then prioritize in JS (cheap, few rows).
  const candidates = await db.select().from(modelLimits).where(
    sql`(${modelLimits.scope} = 'key' AND ${modelLimits.scopeId} = ${apiKeyId})
        OR (${modelLimits.scope} = 'global' AND ${modelLimits.scopeId} = 0)`
  );

  const isExact = (m: ModelLimitRow) =>
    !m.isPattern && (m.model === normalizedModel || m.model.toLowerCase() === lower);
  const isPattern = (m: ModelLimitRow) =>
    !!m.isPattern && lower.includes(m.model.toLowerCase());

  const keyEx = candidates.find(m => m.scope === 'key' && m.promptLimit > 0 && isExact(m));
  if (keyEx) return keyEx;
  const keyPat = candidates.find(m => m.scope === 'key' && m.promptLimit > 0 && isPattern(m));
  if (keyPat) return keyPat;
  const gEx = candidates.find(m => m.scope === 'global' && m.promptLimit > 0 && isExact(m));
  if (gEx) return gEx;
  const gPat = candidates.find(m => m.scope === 'global' && m.promptLimit > 0 && isPattern(m));
  if (gPat) return gPat;
  return null;
}

/**
 * Transaction-aware variant of {@link findActiveOverride} for use inside
 * Drizzle transactions (e.g. the auto-routing block in proxy.ts).
 */
export async function findActiveOverrideInTx(
  tx: { select: typeof db.select },
  apiKeyId: number,
  normalizedModel: string,
): Promise<ModelLimitRow | null> {
  const lower = normalizedModel.toLowerCase();
  const candidates = await tx.select().from(modelLimits).where(
    sql`(${modelLimits.scope} = 'key' AND ${modelLimits.scopeId} = ${apiKeyId})
        OR (${modelLimits.scope} = 'global' AND ${modelLimits.scopeId} = 0)`
  );

  const isExact = (m: ModelLimitRow) =>
    !m.isPattern && (m.model === normalizedModel || m.model.toLowerCase() === lower);
  const isPattern = (m: ModelLimitRow) =>
    !!m.isPattern && lower.includes(m.model.toLowerCase());

  const keyEx = candidates.find(m => m.scope === 'key' && m.promptLimit > 0 && isExact(m));
  if (keyEx) return keyEx;
  const keyPat = candidates.find(m => m.scope === 'key' && m.promptLimit > 0 && isPattern(m));
  if (keyPat) return keyPat;
  const gEx = candidates.find(m => m.scope === 'global' && m.promptLimit > 0 && isExact(m));
  if (gEx) return gEx;
  const gPat = candidates.find(m => m.scope === 'global' && m.promptLimit > 0 && isPattern(m));
  if (gPat) return gPat;
  return null;
}

/**
 * Count user prompts for an API key within a time window.
 * Uses a fixed window that starts on the first request and lasts for `windowStr`.
 */
export async function checkPromptLimit(
  apiKeyId: number,
  promptLimit: number,
  windowStr: string,
): Promise<{ allowed: boolean; remaining: number; resetMs: number; used: number }> {
  if (promptLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };
  const windowMs = parseRateLimitWindow(windowStr);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };

  const keyRecord = (await db.select({ promptWindowStart: apiKeys.promptWindowStart }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)))[0];
  
  let windowStartMs = 0;
  if (keyRecord?.promptWindowStart) {
    windowStartMs = Date.parse(keyRecord.promptWindowStart.replace(" ", "T") + "Z");
  }

  const nowMs = Date.now();

  // If window has expired or doesn't exist, this request will start a new window
  if (!windowStartMs || nowMs >= windowStartMs + windowMs) {
    // We don't write the new window start here to avoid extra DB writes on every check.
    // The actual update will happen when the request is successfully completed and logged.
    // For the check itself, we consider it a fresh window with 0 used.
    return { allowed: true, remaining: promptLimit, resetMs: windowMs, used: 0 };
  }

  // Window is active, calculate how many requests have been made since windowStart
  const windowStartDate = new Date(windowStartMs);
  
  const usage = await db.select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, apiKeyId),
      gte(requestLogs.createdAt, windowStartDate),
      COUNTED_LOG_SQL,
    ));

  const used = (usage[0])?.count || 0;
  const resetMs = Math.max(0, windowStartMs + windowMs - nowMs);
  
  return { allowed: used < promptLimit, remaining: Math.max(0, promptLimit - used), resetMs, used };
}

/**
 * Check per-model prompt limit for an API key.
 * Uses a fixed window that starts on the first request for this model.
 */
export async function checkModelPromptLimit(
  apiKeyId: number,
  model: string,
  perKeyDefaultLimit: number,
  perKeyDefaultWindow: string | null,
  globalDefaultLimit: number,
  globalDefaultWindow: string,
): Promise<{ allowed: boolean; remaining: number; resetMs: number; used: number; effectiveLimit: number }> {
  // Normalize model name so "tokito/ag/claude-opus-4-6" matches "ag/claude-opus-4-6" etc.
  const normalizedModel = await normalizeModelForLimit(model);

  // Resolve the highest-priority override (key exact > key pattern > global exact > global pattern).
  const activeOverride = await findActiveOverride(apiKeyId, normalizedModel);

  let effectiveLimit = 0;

  if (activeOverride && activeOverride.promptLimit > 0) {
    effectiveLimit = activeOverride.promptLimit;
  } else if (perKeyDefaultLimit > 0) {
    effectiveLimit = perKeyDefaultLimit;
  } else {
    effectiveLimit = globalDefaultLimit;
  }

  if (effectiveLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit: 0 };

  const effectiveWindow = perKeyDefaultWindow || globalDefaultWindow || "30m";
  const windowMs = parseRateLimitWindow(effectiveWindow);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit };

  const nowMs = Date.now();
  let windowStartMs = 0;

  // For model limits, we store the window start on the active override if it exists.
  // If there's no override (using default limit), we can't easily track the window start per model.
  // In that case, we fall back to a clock-aligned fixed window.
  if (activeOverride && activeOverride.promptWindowStart) {
    windowStartMs = Date.parse(activeOverride.promptWindowStart.replace(" ", "T") + "Z");
    
    if (nowMs >= windowStartMs + windowMs) {
      return { allowed: true, remaining: effectiveLimit, resetMs: windowMs, used: 0, effectiveLimit };
    }
  } else {
    // No override at all (using default limit) OR override exists but no window start yet.
    // Use clock-aligned fixed window fallback.
    windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  }

  const windowStartDate = new Date(windowStartMs);

  const usage = await db.select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, apiKeyId),
      getModelMatchCondition(normalizedModel),
      gte(requestLogs.createdAt, windowStartDate),
      COUNTED_LOG_SQL,
    ));

  const used = (usage[0])?.count || 0;
  const resetMs = Math.max(0, windowStartMs + windowMs - nowMs);
  
  return {
    allowed: used < effectiveLimit,
    remaining: Math.max(0, effectiveLimit - used),
    resetMs,
    used,
    effectiveLimit,
  };
}

/**
 * Find how many ms until the window resets (sliding window).
 * The window resets when the OLDEST counted request in the window expires.
 */
export async function getWindowResetMs(apiKeyId: number, windowMs: number, model?: string): Promise<number> {
  if (windowMs <= 0) return 0;
  
  const nowMs = Date.now();
  
  if (model) {
    const normalizedModel = await normalizeModelForLimit(model);

    // Model specific limit — match any variant that normalizes to the same base,
    // including pattern matches (substring, case-insensitive).
    const activeOverride = await findActiveOverride(apiKeyId, normalizedModel);
    
    if (activeOverride && activeOverride.promptWindowStart) {
      const windowStartMs = Date.parse(activeOverride.promptWindowStart.replace(" ", "T") + "Z");
      if (nowMs < windowStartMs + windowMs) {
        return Math.max(0, windowStartMs + windowMs - nowMs);
      }
    } else {
      // No override (using default limit) OR override exists but no window start yet.
      // Use clock-aligned fixed window fallback.
      const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
      return Math.max(0, windowStartMs + windowMs - nowMs);
    }
    
    return windowMs;
  }
  
  // Global prompt limit
  const keyRecord = (await db.select({ promptWindowStart: apiKeys.promptWindowStart }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)))[0];
  
  if (keyRecord?.promptWindowStart) {
    const windowStartMs = Date.parse(keyRecord.promptWindowStart.replace(" ", "T") + "Z");
    if (nowMs < windowStartMs + windowMs) {
      return Math.max(0, windowStartMs + windowMs - nowMs);
    }
  }
  
  return windowMs;
}
