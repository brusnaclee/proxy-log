import { sql } from "drizzle-orm";

/** Rows that count toward user prompt usage. */
export const COUNTED_LOG_SQL = sql`is_counted_request IS NOT 0 AND status_code BETWEEN 200 AND 299`;

/** Rows that count toward token billing (prompts + tool followups). */
export const BILLABLE_LOG_SQL = sql`is_billable_token IS NOT 0 AND status_code BETWEEN 200 AND 299`;

export const VALID_LOG_SQL = sql`(is_counted_request IS NOT 0 OR is_billable_token IS NOT 0) AND status_code BETWEEN 200 AND 299`;

/** WIB midnight as SQLite datetime string (UTC storage). */
export function wibTodayStartSql(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset).toISOString().replace("T", " ").substring(0, 19);
}

/** WIB calendar month start as SQLite datetime string. */
export function wibMonthStartSql(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCDate(1);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset).toISOString().replace("T", " ").substring(0, 19);
}
