import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { requestLogs, chatSessions, cleanupState } from "../db/schema.js";
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
 * Returns SQLite-compatible datetime strings.
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
    const state = await db.select()
      .from(cleanupState)
      .where(eq(cleanupState.cleanupType, "transcripts"))
      .get();

    // Check if yesterday has already been cleaned
    const cleanedDays: string[] = state?.cleanedDays ? JSON.parse(state.cleanedDays) : [];
    if (cleanedDays.includes(yesterday)) {
      // Already cleaned yesterday, skip
      return { success: true, clearedCount: 0 };
    }

    // Clear heavy fields from YESTERDAY's data only (not today!)
    // Keep all metadata: tokens, cost, status_code, is_counted_request, etc.
    const res = await db.update(requestLogs)
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
      `)
      .run();

    // Also clean yesterday's session previews
    await db.update(chatSessions)
      .set({ lastRequestPreview: "" })
      .where(sql`last_seen_at >= ${start} AND last_seen_at <= ${end} AND last_request_preview != ''`)
      .run();

    // Update state - mark yesterday as cleaned
    const now = new Date().toISOString();
    const updatedDays = [...cleanedDays, yesterday].sort();

    // Keep only last 7 days in state to avoid infinite growth
    const recentDays = updatedDays.slice(-7);

    await db.update(cleanupState)
      .set({
        lastCleanupAt: now,
        cleanedDays: JSON.stringify(recentDays),
        updatedAt: now
      })
      .where(eq(cleanupState.cleanupType, "transcripts"))
      .run();

    console.log(`[cleanup] Transcript cleanup completed for ${yesterday}. Cleared ${res.rowsAffected} rows.`);
    return { success: true, clearedCount: res.rowsAffected };
  } catch (error: any) {
    console.error("[cleanup] Transcript cleanup failed:", error);
    return { success: false, clearedCount: 0 };
  }
}

// ─── 3-Month Rolling Cleanup ──────────────────────────────────────────────────

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
    const state = await db.select()
      .from(cleanupState)
      .where(eq(cleanupState.cleanupType, "3month"))
      .get();

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

      // Delete request logs for this month
      const deletedLogs = await db.delete(requestLogs)
        .where(sql`created_at >= ${start} AND created_at < ${end}`)
        .run();

      // Delete sessions for this month
      const deletedSessions = await db.delete(chatSessions)
        .where(sql`last_seen_at >= ${start} AND last_seen_at < ${end}`)
        .run();

      totalDeletedLogs += deletedLogs.rowsAffected;
      totalDeletedSessions += deletedSessions.rowsAffected;
      newlyCleaned.push(yearMonth);

      console.log(`[cleanup] Month ${yearMonth}: deleted ${deletedLogs.rowsAffected} logs, ${deletedSessions.rowsAffected} sessions`);
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
        updatedAt: now.toISOString()
      })
      .where(eq(cleanupState.cleanupType, "3month"))
      .run();

    // Run VACUUM to reclaim disk space
    if (totalDeletedLogs > 0 || totalDeletedSessions > 0) {
      await db.run(sql`VACUUM`);
      console.log("[cleanup] VACUUM completed");
    }

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
    const res = await db.update(requestLogs)
      .set({
        transcriptSnapshot: "",
        requestPreview: "",
        responsePreview: "",
        errorMessage: ""
      })
      .where(sql`
        created_at < datetime('now', '-1 day')
        AND (
          transcript_snapshot != ''
          OR request_preview != ''
          OR response_preview != ''
          OR (error_message IS NOT NULL AND error_message != '')
        )
      `)
      .run();

    await db.update(chatSessions)
      .set({ lastRequestPreview: "" })
      .where(sql`last_seen_at < datetime('now', '-1 day') AND last_request_preview != ''`)
      .run();

    // Update state
    await db.update(cleanupState)
      .set({
        lastCleanupAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(cleanupState.cleanupType, "transcripts"))
      .run();

    return { success: true, clearedCount: res.rowsAffected };
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

    const deletedLogs = await db.delete(requestLogs)
      .where(sql`created_at >= ${start} AND created_at < ${end}`)
      .run();

    const deletedSessions = await db.delete(chatSessions)
      .where(sql`last_seen_at >= ${start} AND last_seen_at < ${end}`)
      .run();

    // Update state
    const state = await db.select()
      .from(cleanupState)
      .where(eq(cleanupState.cleanupType, "3month"))
      .get();

    const cleanedMonths: string[] = state?.cleanedMonths ? JSON.parse(state.cleanedMonths) : [];
    if (!cleanedMonths.includes(yearMonth)) {
      cleanedMonths.push(yearMonth);
      cleanedMonths.sort();

      await db.update(cleanupState)
        .set({
          lastCleanupAt: new Date().toISOString(),
          cleanedMonths: JSON.stringify(cleanedMonths.slice(-12)),
          updatedAt: new Date().toISOString()
        })
        .where(eq(cleanupState.cleanupType, "3month"))
        .run();
    }

    return { success: true, deletedLogs: deletedLogs.rowsAffected, deletedSessions: deletedSessions.rowsAffected };
  } catch (error: any) {
    console.error(`[cleanup] Force clean month ${yearMonth} failed:`, error);
    return { success: false, deletedLogs: 0, deletedSessions: 0 };
  }
}

/**
 * Get cleanup status for admin dashboard.
 */
export async function getCleanupStatus(): Promise<any> {
  const states = await db.select().from(cleanupState).all();

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
