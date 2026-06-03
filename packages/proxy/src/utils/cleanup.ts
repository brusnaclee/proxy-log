import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { requestLogs, chatSessions, cleanupState, monthlyStats } from "../db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Stateful cleanup system that tracks what has been cleaned.
 *
 * - Daily cleanup: Check every 3 hours, clear YESTERDAY's data if not already cleaned
 * - 3-month cleanup: Runs daily, deletes data from months that are 3+ months old
 *
 * Today's data is NEVER touched - only yesterday and earlier.
 */

// ─── Helper: Get yesterday's date range in WIB (UTC+7) ───────────────────────

/**
 * Get yesterday's date as YYYY-MM-DD string in WIB timezone.
 */
function getYesterdayWIB(): string {
  const now = new Date();
  // Convert to WIB (UTC+7)
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);

  // Get yesterday in WIB
  wibNow.setDate(wibNow.getDate() - 1);
  const year = wibNow.getUTCFullYear();
  const month = String(wibNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(wibNow.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Get date range for a specific date (00:00:00 to 23:59:59).
 * Returns PostgreSQL-compatible datetime strings.
 */
function getDayRange(dateStr: string): { start: string; end: string } {
  return {
    start: `${dateStr} 00:00:00`,
    end: `${dateStr} 23:59:59`
  };
}

// ─── Daily Transcript Cleanup ─────────────────────────────────────────────────

/**
 * Clear heavy fields from YESTERDAY's data only.
 * Runs every 3 hours, skips if yesterday already cleaned.
 * NEVER touches today's data.
 */
export async function runTranscriptCleanup(): Promise<{ success: boolean; clearedCount: number }> {
  try {
    const yesterday = getYesterdayWIB();
    const { start, end } = getDayRange(yesterday);

    // Get current state
    const stateRows = await db.select()
      .from(cleanupState)
      .where(eq(cleanupState.cleanupType, "transcripts"));
    const state = stateRows[0] ?? null;

    // Check if yesterday has already been cleaned
    const cleanedDays: string[] = state?.cleanedDays ? JSON.parse(state.cleanedDays) : [];
    if (cleanedDays.includes(yesterday)) {
      // Already cleaned yesterday, skip
      return { success: true, clearedCount: 0 };
    }

    // Clear heavy fields from YESTERDAY's data only (not today!)
    // Keep all metadata: tokens, cost, status_code, is_counted_request, etc.
    await db.update(requestLogs)
      .set({
        transcriptSnapshot: "",
        requestPreview: "",
        responsePreview: "",
        errorMessage: ""
      })
      .where(sql`
        created_at >= ${start}
        AND created_at <= ${end}
        AND (
          transcript_snapshot != ''
          OR request_preview != ''
          OR response_preview != ''
          OR (error_message IS NOT NULL AND error_message != '')
        )
      `);

    // Also clean yesterday's session previews
    await db.update(chatSessions)
      .set({ lastRequestPreview: "" })
      .where(sql`last_seen_at >= ${start} AND last_seen_at <= ${end} AND last_request_preview != ''`);

    // Update state - mark yesterday as cleaned
    const now = new Date().toISOString();
    const updatedDays = [...cleanedDays, yesterday].sort();

    // Keep only last 7 days in state to avoid infinite growth
    const recentDays = updatedDays.slice(-7);

    await db.update(cleanupState)
      .set({
        lastCleanupAt: now,
        cleanedDays: JSON.stringify(recentDays),
        updatedAt: new Date()
      })
      .where(eq(cleanupState.cleanupType, "transcripts"));

    console.log(`[cleanup] Transcript cleanup completed for ${yesterday}.`);
    return { success: true, clearedCount: 0 };
  } catch (error: any) {
    console.error("[cleanup] Transcript cleanup failed:", error);
    return { success: false, clearedCount: 0 };
  }
}

// ─── 3-Month Rolling Cleanup ──────────────────────────────────────────────────

/**
 * Snapshot aggregated stats for a month into monthly_stats before deletion.
 * This preserves per-user, per-model, and global totals so the dashboard
 * and Discord bot can still show historical data after raw logs are deleted.
 */
async function snapshotMonthStats(yearMonth: string): Promise<void> {
  const { start, end } = getMonthRange(yearMonth);

  // Check if already snapshotted
  const existingRows = await db.select({ id: monthlyStats.id })
    .from(monthlyStats)
    .where(eq(monthlyStats.yearMonth, yearMonth))
    .limit(1);
  const existing = existingRows[0] ?? null;

  if (existing) {
    console.log(`[cleanup] Month ${yearMonth} already snapshotted, skipping`);
    return;
  }

  console.log(`[cleanup] Snapshotting stats for month ${yearMonth}...`);

  // 1. Per-(api_key_id, model) aggregates
  const perKeyModel = (await db.execute(sql`
    SELECT
      api_key_id,
      CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
      COUNT(DISTINCT turn_id) as turn_count,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END), 0) as input_tokens,
      COALESCE(SUM(completion_tokens), 0) as output_tokens,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) + SUM(completion_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as estimated_cost
    FROM request_logs
    WHERE created_at >= ${start} AND created_at < ${end} AND status_code BETWEEN 200 AND 299
    GROUP BY api_key_id, CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END
  `)).rows;

  // 2. Also add underlying model counts for auto entries
  const perKeyAutoModels = (await db.execute(sql`
    SELECT
      api_key_id,
      TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
      COUNT(DISTINCT turn_id) as turn_count,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END), 0) as input_tokens,
      COALESCE(SUM(completion_tokens), 0) as output_tokens,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) + SUM(completion_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as estimated_cost
    FROM request_logs
    WHERE model LIKE 'auto (%)%' AND created_at >= ${start} AND created_at < ${end} AND status_code BETWEEN 200 AND 299
    GROUP BY api_key_id, TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1))
  `)).rows;

  // 3. Global aggregates (all keys combined, per model)
  const globalModel = (await db.execute(sql`
    SELECT
      CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
      COUNT(DISTINCT turn_id) as turn_count,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END), 0) as input_tokens,
      COALESCE(SUM(completion_tokens), 0) as output_tokens,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) + SUM(completion_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as estimated_cost
    FROM request_logs
    WHERE created_at >= ${start} AND created_at < ${end} AND status_code BETWEEN 200 AND 299
    GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END
  `)).rows;

  // 4. Global total (all keys, all models)
  const globalTotal = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT turn_id) as turn_count,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END), 0) as input_tokens,
      COALESCE(SUM(completion_tokens), 0) as output_tokens,
      COALESCE(SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) + SUM(completion_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as estimated_cost
    FROM request_logs
    WHERE created_at >= ${start} AND created_at < ${end} AND status_code BETWEEN 200 AND 299
  `)).rows[0];

  // Insert all snapshots
  const rows: any[] = [];

  for (const r of perKeyModel as any[]) {
    rows.push({ yearMonth, apiKeyId: r.api_key_id, model: r.model, turnCount: r.turn_count, inputTokens: r.input_tokens, outputTokens: r.output_tokens, totalTokens: r.total_tokens, estimatedCost: r.estimated_cost });
  }
  for (const r of perKeyAutoModels as any[]) {
    rows.push({ yearMonth, apiKeyId: r.api_key_id, model: r.model, turnCount: r.turn_count, inputTokens: r.input_tokens, outputTokens: r.output_tokens, totalTokens: r.total_tokens, estimatedCost: r.estimated_cost });
  }
  for (const r of globalModel as any[]) {
    rows.push({ yearMonth, apiKeyId: null, model: r.model, turnCount: r.turn_count, inputTokens: r.input_tokens, outputTokens: r.output_tokens, totalTokens: r.total_tokens, estimatedCost: r.estimated_cost });
  }
  if (globalTotal as any) {
    const gt = globalTotal as any;
    rows.push({ yearMonth, apiKeyId: null, model: '_all_', turnCount: gt.turn_count, inputTokens: gt.input_tokens, outputTokens: gt.output_tokens, totalTokens: gt.total_tokens, estimatedCost: gt.estimated_cost });
  }

  // Batch insert
  if (rows.length > 0) {
    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await db.insert(monthlyStats).values(batch);
    }
    console.log(`[cleanup] Snapshotted ${rows.length} aggregated rows for month ${yearMonth}`);
  }
}

/**
 * Get list of months that should be cleaned (3+ months old).
 * Example: If current date is 2026-06-15, returns ["2026-01", "2026-02", "2026-03"]
 */
function getMonthsToClean(currentDate: Date): string[] {
  const monthsToClean: string[] = [];

  // Go back 3 to 5 months (rolling window)
  for (let i = 3; i <= 5; i++) {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() - i);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthsToClean.push(yearMonth);
  }

  return monthsToClean;
}

/**
 * Parse "YYYY-MM" to start/end datetime strings for that month.
 */
function getMonthRange(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01 00:00:00`;

  // End is first day of next month
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00`;

  return { start, end };
}

export async function run3MonthCleanup(): Promise<{ success: boolean; deletedLogs: number; deletedSessions: number }> {
  try {
    const now = new Date();

    // Get current state
    const stateRows3m = await db.select()
      .from(cleanupState)
      .where(eq(cleanupState.cleanupType, "3month"));
    const state = stateRows3m[0] ?? null;

    const cleanedMonths: string[] = state?.cleanedMonths ? JSON.parse(state.cleanedMonths) : [];

    // Get months that should be cleaned
    const monthsToClean = getMonthsToClean(now);

    // Filter out months already cleaned
    const pendingMonths = monthsToClean.filter(m => !cleanedMonths.includes(m));

    if (pendingMonths.length === 0) {
      console.log("[cleanup] 3-month cleanup - no new months to clean");
      return { success: true, deletedLogs: 0, deletedSessions: 0 };
    }

    let totalDeletedLogs = 0;
    let totalDeletedSessions = 0;
    const newlyCleaned: string[] = [];

    for (const yearMonth of pendingMonths) {
      const { start, end } = getMonthRange(yearMonth);

      console.log(`[cleanup] Cleaning month ${yearMonth} (${start} to ${end})`);

      // Snapshot aggregated stats before deletion
      await snapshotMonthStats(yearMonth);

      // Delete request logs for this month
      const deletedLogs = await db.delete(requestLogs)
        .where(sql`created_at >= ${start} AND created_at < ${end}`);

      // Delete sessions for this month
      const deletedSessions = await db.delete(chatSessions)
        .where(sql`last_seen_at >= ${start} AND last_seen_at < ${end}`);

      const deletedLogsCount = deletedLogs.rowCount ?? 0;
      const deletedSessionsCount = deletedSessions.rowCount ?? 0;

      totalDeletedLogs += deletedLogsCount;
      totalDeletedSessions += deletedSessionsCount;
      newlyCleaned.push(yearMonth);

      console.log(`[cleanup] Month ${yearMonth}: deleted ${deletedLogsCount} logs, ${deletedSessionsCount} sessions`);
    }

    // Update state with newly cleaned months
    const allCleanedMonths = [...cleanedMonths, ...newlyCleaned].sort();

    // Keep only last 12 months in state to avoid infinite growth
    const recentCleaned = allCleanedMonths.slice(-12);

    await db.update(cleanupState)
      .set({
        lastCleanupAt: now.toISOString(),
        lastProcessedMonth: pendingMonths[pendingMonths.length - 1],
        cleanedMonths: JSON.stringify(recentCleaned),
        updatedAt: new Date()
      })
      .where(eq(cleanupState.cleanupType, "3month"));

    console.log(`[cleanup] 3-month cleanup completed. Deleted ${totalDeletedLogs} logs, ${totalDeletedSessions} sessions from months: ${newlyCleaned.join(', ')}`);
    return { success: true, deletedLogs: totalDeletedLogs, deletedSessions: totalDeletedSessions };
  } catch (error: any) {
    console.error("[cleanup] 3-month cleanup failed:", error);
    return { success: false, deletedLogs: 0, deletedSessions: 0 };
  }
}

// ─── Manual Cleanup Endpoints ─────────────────────────────────────────────────

/**
 * Force run transcript cleanup (ignores time check).
 * For manual trigger from admin dashboard.
 */
export async function forceTranscriptCleanup(): Promise<{ success: boolean; clearedCount: number }> {
  try {
    await db.update(requestLogs)
      .set({
        transcriptSnapshot: "",
        requestPreview: "",
        responsePreview: "",
        errorMessage: ""
      })
      .where(sql`
        created_at < NOW() - INTERVAL '1 day'
        AND (
          transcript_snapshot != ''
          OR request_preview != ''
          OR response_preview != ''
          OR (error_message IS NOT NULL AND error_message != '')
        )
      `);

    await db.update(chatSessions)
      .set({ lastRequestPreview: "" })
      .where(sql`last_seen_at < NOW() - INTERVAL '1 day' AND last_request_preview != ''`);

    // Update state
    await db.update(cleanupState)
      .set({
        lastCleanupAt: new Date().toISOString(),
        updatedAt: new Date()
      })
      .where(eq(cleanupState.cleanupType, "transcripts"));

    return { success: true, clearedCount: 0 };
  } catch (error: any) {
    console.error("[cleanup] Force transcript cleanup failed:", error);
    return { success: false, clearedCount: 0 };
  }
}

/**
 * Force run 3-month cleanup for a specific month.
 * For manual trigger from admin dashboard.
 */
export async function forceCleanMonth(yearMonth: string): Promise<{ success: boolean; deletedLogs: number; deletedSessions: number }> {
  try {
    const { start, end } = getMonthRange(yearMonth);

    // Snapshot aggregated stats before deletion
    await snapshotMonthStats(yearMonth);

    const deletedLogs = await db.delete(requestLogs)
      .where(sql`created_at >= ${start} AND created_at < ${end}`);

    const deletedSessions = await db.delete(chatSessions)
      .where(sql`last_seen_at >= ${start} AND last_seen_at < ${end}`);

    // Update state
    const stateRowsForce = await db.select()
      .from(cleanupState)
      .where(eq(cleanupState.cleanupType, "3month"));
    const state = stateRowsForce[0] ?? null;

    const cleanedMonths: string[] = state?.cleanedMonths ? JSON.parse(state.cleanedMonths) : [];
    if (!cleanedMonths.includes(yearMonth)) {
      cleanedMonths.push(yearMonth);
      cleanedMonths.sort();

      await db.update(cleanupState)
        .set({
          lastCleanupAt: new Date().toISOString(),
          cleanedMonths: JSON.stringify(cleanedMonths.slice(-12)),
          updatedAt: new Date()
        })
        .where(eq(cleanupState.cleanupType, "3month"));
    }

    return { success: true, deletedLogs: deletedLogs.rowCount ?? 0, deletedSessions: deletedSessions.rowCount ?? 0 };
  } catch (error: any) {
    console.error(`[cleanup] Force clean month ${yearMonth} failed:`, error);
    return { success: false, deletedLogs: 0, deletedSessions: 0 };
  }
}

/**
 * Get cleanup status for admin dashboard.
 */
export async function getCleanupStatus(): Promise<any> {
  const states = await db.select().from(cleanupState);

  const result: any = {};
  for (const state of states) {
    result[state.cleanupType] = {
      lastCleanupAt: state.lastCleanupAt,
      lastProcessedMonth: state.lastProcessedMonth,
      cleanedMonths: state.cleanedMonths ? JSON.parse(state.cleanedMonths) : [],
      cleanedDays: state.cleanedDays ? JSON.parse(state.cleanedDays) : []
    };
  }

  return result;
}
