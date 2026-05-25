import { db } from "../db/index.js";
import { requestLogs, chatSessions } from "../db/schema.js";
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
