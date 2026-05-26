import { db } from "../db/index.js";
import { requestLogs, chatSessions, modelLimits } from "../db/schema.js";
import { sql, and, eq, gte } from "drizzle-orm";

export function parseRateLimitWindow(windowStr: string | null | undefined): number {
  if (!windowStr) return 0;
  const match = windowStr.trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  if (isNaN(value)) return 0;
  
  switch(unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

export async function checkRateLimit(apiKeyId: number, configLimit: number, configWindowStr: string): Promise<{ allowed: boolean, remaining: number, resetMs: number }> {
  if (configLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0 };
  
  const windowMs = parseRateLimitWindow(configWindowStr);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0 };

  const now = Date.now();
  const windowStart = new Date(now - windowMs).toISOString().replace("T", " ").substring(0, 19);
  
  const usage = await db.select({
    count: sql<number>`count(*)`
  })
  .from(requestLogs)
  .where(
    and(
      eq(requestLogs.apiKeyId, apiKeyId),
      gte(requestLogs.createdAt, windowStart),
      sql`is_counted_request IS NOT 0`
    )
  )
  .get();

  const count = usage?.count || 0;
  const allowed = count < configLimit;
  const remaining = Math.max(0, configLimit - count);
  const resetMs = windowMs; // naive reset: full window length from now
  
  return { allowed, remaining, resetMs };
}

/**
 * Check prompt-based rate limit for an API key.
 * Counts unique user prompts (not individual HTTP requests) within a time window.
 * A "prompt" is counted when a new session starts or the context changes (user sends a new message).
 * Agent/tool follow-up requests within the same prompt are NOT counted.
 */
export async function checkPromptLimit(apiKeyId: number, promptLimit: number, windowStr: string): Promise<{ allowed: boolean, remaining: number, resetMs: number, used: number }> {
  if (promptLimit <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };

  const windowMs = parseRateLimitWindow(windowStr);
  if (windowMs <= 0) return { allowed: true, remaining: -1, resetMs: 0, used: 0 };

  const now = Date.now();
  const windowStart = new Date(now - windowMs).toISOString().replace("T", " ").substring(0, 19);

  // Count prompts from chat_sessions where the session was active within the window
  // Each session's promptCount tracks how many user prompts happened in that session
  const usage = await db.select({
    total: sql<number>`COALESCE(SUM(prompt_count), 0)`
  })
  .from(chatSessions)
  .where(
    and(
      eq(chatSessions.apiKeyId, apiKeyId),
      gte(chatSessions.lastSeenAt, windowStart)
    )
  )
  .get();

  const used = usage?.total || 0;
  const allowed = used < promptLimit;
  const remaining = Math.max(0, promptLimit - used);
  const resetMs = windowMs;

  return { allowed, remaining, resetMs, used };
}

/**
 * Check per-model prompt limit for an API key.
 * Counts user prompts for a SPECIFIC model within a time window.
 * Uses request_logs with is_counted_request=1 AND model=X.
 *
 * Resolution order for the effective limit:
 *   1. Per-key model override (model_limits WHERE scope='key' AND scope_id=apiKeyId AND model=X)
 *   2. Per-key default per-model limit (api_keys.per_model_prompt_limit)
 *   3. Global model override (model_limits WHERE scope='global' AND scope_id=0 AND model=X)
 *   4. Global default per-model limit (admin_config.global_per_model_prompt_limit)
 */
export async function checkModelPromptLimit(
  apiKeyId: number,
  model: string,
  perKeyDefaultLimit: number,
  perKeyDefaultWindow: string | null,
  globalDefaultLimit: number,
  globalDefaultWindow: string,
): Promise<{ allowed: boolean; remaining: number; resetMs: number; used: number; effectiveLimit: number }> {
  // 1. Check per-key model override
  const keyOverride = await db.select()
    .from(modelLimits)
    .where(and(
      eq(modelLimits.scope, "key"),
      eq(modelLimits.scopeId, apiKeyId),
      eq(modelLimits.model, model),
    ))
    .get();

  // 2. Check global model override
  const globalOverride = await db.select()
    .from(modelLimits)
    .where(and(
      eq(modelLimits.scope, "global"),
      eq(modelLimits.scopeId, 0),
      eq(modelLimits.model, model),
    ))
    .get();

  // Resolve effective limit (priority: key override > key default > global override > global default)
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

  if (effectiveLimit <= 0) {
    return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit: 0 };
  }

  // Resolve effective window (per-key window > global window)
  const effectiveWindow = perKeyDefaultWindow || globalDefaultWindow || "1d";
  const windowMs = parseRateLimitWindow(effectiveWindow);
  if (windowMs <= 0) {
    return { allowed: true, remaining: -1, resetMs: 0, used: 0, effectiveLimit };
  }

  const windowStart = new Date(Date.now() - windowMs).toISOString().replace("T", " ").substring(0, 19);

  // Count user prompts for this specific model
  const usage = await db.select({
    count: sql<number>`count(*)`
  })
  .from(requestLogs)
  .where(and(
    eq(requestLogs.apiKeyId, apiKeyId),
    eq(requestLogs.model, model),
    gte(requestLogs.createdAt, windowStart),
    sql`is_counted_request IS NOT 0`
  ))
  .get();

  const used = usage?.count || 0;
  const allowed = used < effectiveLimit;
  const remaining = Math.max(0, effectiveLimit - used);

  return { allowed, remaining, resetMs: windowMs, used, effectiveLimit };
}
