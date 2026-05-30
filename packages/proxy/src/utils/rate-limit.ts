import { db } from "../db/index.js";
import { requestLogs, modelLimits, apiKeys } from "../db/schema.js";
import { sql, and, eq, gte } from "drizzle-orm";
import { COUNTED_LOG_SQL } from "./counting.js";

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

  const keyRecord = await db.select({ promptWindowStart: apiKeys.promptWindowStart }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get();
  
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
  const windowStartStr = new Date(windowStartMs).toISOString().replace("T", " ").substring(0, 19);
  
  const usage = await db.select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, apiKeyId),
      gte(requestLogs.createdAt, windowStartStr),
      COUNTED_LOG_SQL,
    ))
    .get();

  const used = usage?.count || 0;
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
  // 1. Per-key model override
  const keyOverride = await db.select().from(modelLimits)
    .where(and(eq(modelLimits.scope, "key"), eq(modelLimits.scopeId, apiKeyId), eq(modelLimits.model, model)))
    .get();

  // 2. Global model override
  const globalOverride = await db.select().from(modelLimits)
    .where(and(eq(modelLimits.scope, "global"), eq(modelLimits.scopeId, 0), eq(modelLimits.model, model)))
    .get();

  let effectiveLimit = 0;
  let activeOverride = null;
  
  if (keyOverride && keyOverride.promptLimit > 0) {
    effectiveLimit = keyOverride.promptLimit;
    activeOverride = keyOverride;
  } else if (perKeyDefaultLimit > 0) {
    effectiveLimit = perKeyDefaultLimit;
  } else if (globalOverride && globalOverride.promptLimit > 0) {
    effectiveLimit = globalOverride.promptLimit;
    activeOverride = globalOverride;
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
  } else if (!activeOverride) {
     // Clock-aligned fixed window fallback for defaults
     windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  }

  const windowStartStr = new Date(windowStartMs).toISOString().replace("T", " ").substring(0, 19);

  const usage = await db.select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, apiKeyId),
      eq(requestLogs.model, model),
      gte(requestLogs.createdAt, windowStartStr),
      COUNTED_LOG_SQL,
    ))
    .get();

  const used = usage?.count || 0;
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
    // Model specific limit
    const keyOverride = await db.select().from(modelLimits)
      .where(and(eq(modelLimits.scope, "key"), eq(modelLimits.scopeId, apiKeyId), eq(modelLimits.model, model)))
      .get();
      
    const globalOverride = await db.select().from(modelLimits)
      .where(and(eq(modelLimits.scope, "global"), eq(modelLimits.scopeId, 0), eq(modelLimits.model, model)))
      .get();
      
    const activeOverride = (keyOverride && keyOverride.promptLimit > 0) ? keyOverride : (globalOverride && globalOverride.promptLimit > 0) ? globalOverride : null;
    
    if (activeOverride && activeOverride.promptWindowStart) {
      const windowStartMs = Date.parse(activeOverride.promptWindowStart.replace(" ", "T") + "Z");
      if (nowMs < windowStartMs + windowMs) {
        return Math.max(0, windowStartMs + windowMs - nowMs);
      }
    } else if (!activeOverride) {
      // Clock-aligned fixed window fallback for defaults
      const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
      return Math.max(0, windowStartMs + windowMs - nowMs);
    }
    
    return windowMs;
  }
  
  // Global prompt limit
  const keyRecord = await db.select({ promptWindowStart: apiKeys.promptWindowStart }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get();
  
  if (keyRecord?.promptWindowStart) {
    const windowStartMs = Date.parse(keyRecord.promptWindowStart.replace(" ", "T") + "Z");
    if (nowMs < windowStartMs + windowMs) {
      return Math.max(0, windowStartMs + windowMs - nowMs);
    }
  }
  
  return windowMs;
}
