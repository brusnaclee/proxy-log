import { db } from "../db/index.js";
import { requestLogs, modelLimits } from "../db/schema.js";
import { sql, and, eq, gte } from "drizzle-orm";

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
 * Counts from request_logs WHERE is_counted_request = 1.
 */
export async function checkPromptLimit(
  apiKeyId: number,
  promptLimit: number,
  windowStr: string,
): Promise<{ allowed: boolean; remaining: number; resetMs: number; used: number }> {
  if (promptLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };
  const windowMs = parseRateLimitWindow(windowStr);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };

  const windowStart = new Date(Date.now() - windowMs).toISOString().replace("T", " ").substring(0, 19);
  const usage = await db.select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, apiKeyId),
      gte(requestLogs.createdAt, windowStart),
      sql`is_counted_request IS NOT 0`,
    ))
    .get();

  const used = usage?.count || 0;
  return { allowed: used < promptLimit, remaining: Math.max(0, promptLimit - used), resetMs: windowMs, used };
}

/**
 * Check per-model prompt limit for an API key.
 * Priority: per-key model override > per-key default > global model override > global default.
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
  if (keyOverride && keyOverride.promptLimit > 0) {
    effectiveLimit = keyOverride.promptLimit;
  } else if (perKeyDefaultLimit > 0) {
    effectiveLimit = perKeyDefaultLimit;
  } else if (globalOverride && globalOverride.promptLimit > 0) {
    effectiveLimit = globalOverride.promptLimit;
  } else {
    effectiveLimit = globalDefaultLimit;
  }

  if (effectiveLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit: 0 };

  const effectiveWindow = perKeyDefaultWindow || globalDefaultWindow || "30m";
  const windowMs = parseRateLimitWindow(effectiveWindow);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit };

  const windowStart = new Date(Date.now() - windowMs).toISOString().replace("T", " ").substring(0, 19);
  const usage = await db.select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, apiKeyId),
      eq(requestLogs.model, model),
      gte(requestLogs.createdAt, windowStart),
      sql`is_counted_request IS NOT 0`,
    ))
    .get();

  const used = usage?.count || 0;
  return {
    allowed: used < effectiveLimit,
    remaining: Math.max(0, effectiveLimit - used),
    resetMs: windowMs,
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
  const windowStart = new Date(Date.now() - windowMs).toISOString().replace("T", " ").substring(0, 19);

  const conditions: any[] = [
    eq(requestLogs.apiKeyId, apiKeyId),
    gte(requestLogs.createdAt, windowStart),
    sql`is_counted_request IS NOT 0`,
  ];
  if (model) conditions.push(eq(requestLogs.model, model));

  const oldest = await db.select({ createdAt: requestLogs.createdAt })
    .from(requestLogs)
    .where(and(...conditions))
    .orderBy(requestLogs.createdAt)
    .limit(1)
    .get();

  if (!oldest?.createdAt) return windowMs;
  const oldestTime = Date.parse(oldest.createdAt.replace(" ", "T") + "Z");
  const resetAt = oldestTime + windowMs;
  return Math.max(0, resetAt - Date.now());
}
