/**
 * Monthly Recap access window logic (WIB / UTC+7).
 *
 * Window rules:
 *  - daysInMonth = number of days in the current WIB month.
 *  - openDay = daysInMonth - 2  (H-2 of month end). e.g. 31->29, 30->28, Feb28->26.
 *  - The recap window is OPEN from `openDay` of month M through day 5 of month M+1
 *    (inclusive, until 23:59:59 WIB on the 5th).
 *  - Target month (the month being recapped):
 *      * if WIB day-of-month <= 5  -> the PREVIOUS month (we are in the tail of M-1's window)
 *      * else (day >= openDay)     -> the CURRENT month
 *  - Outside the window the button is visible but access is denied with a message
 *    telling the user when it opens/closes.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** Current date/time expressed in WIB as a Date whose UTC fields are WIB wall-clock. */
function wibNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + WIB_OFFSET_MS);
}

/** Days in a given (year, monthIndex0) — monthIndex0 is 0-based. */
function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Compute openDay for a month: daysInMonth - 2. */
export function computeOpenDay(year: number, monthIndex0: number): number {
  return daysInMonth(year, monthIndex0) - 2;
}

export interface RecapWindow {
  isOpen: boolean;
  /** Whether the panel button should be visible in the channel (from the 25th through the 5th). */
  panelVisible: boolean;
  /** Target month being recapped, "YYYY-MM". */
  yearMonth: string;
  /** Human label e.g. "Mei 2026". */
  monthLabel: string;
  /** Day-of-month the window opens for the current cycle. */
  openDay: number;
  /** Month label for the open day (the month that is ending / being recapped's NEXT period start). */
  openMonthLabel: string;
  /** Closing label, day 5 of the month after the target. */
  closeMonthLabel: string;
  /** Human readable access message (Indonesian). */
  message: string;
  /** WIB day-of-month right now. */
  todayDay: number;
}

function ym(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

/**
 * Resolve the recap window state for "now".
 */
export function getRecapWindow(now: Date = new Date()): RecapWindow {
  const w = wibNow(now);
  const year = w.getUTCFullYear();
  const month0 = w.getUTCMonth();
  const day = w.getUTCDate();

  const openDayCurrent = computeOpenDay(year, month0);

  // Previous month (for the tail part of the window, days 1..5).
  const prevMonth0 = month0 === 0 ? 11 : month0 - 1;
  const prevYear = month0 === 0 ? year - 1 : year;

  let isOpen = false;
  let targetYear = year;
  let targetMonth0 = month0;

  if (day <= 5) {
    // Tail of previous month's window.
    isOpen = true;
    targetYear = prevYear;
    targetMonth0 = prevMonth0;
  } else if (day >= openDayCurrent) {
    // Start of current month's window.
    isOpen = true;
    targetYear = year;
    targetMonth0 = month0;
  } else {
    // Closed. The upcoming target is the current month (opens at openDayCurrent).
    isOpen = false;
    targetYear = year;
    targetMonth0 = month0;
  }

  // close month = month after target
  const closeMonth0 = targetMonth0 === 11 ? 0 : targetMonth0 + 1;
  const closeYear = targetMonth0 === 11 ? targetYear + 1 : targetYear;

  // open day for the target month's cycle
  const targetOpenDay = computeOpenDay(targetYear, targetMonth0);

  const monthLabel = `${MONTH_NAMES_ID[targetMonth0]} ${targetYear}`;
  const openMonthLabel = `${MONTH_NAMES_ID[targetMonth0]}`;
  const closeMonthLabel = `${MONTH_NAMES_ID[closeMonth0]}`;

  let message: string;
  if (isOpen) {
    message = `Recap ${monthLabel} bisa diakses sampai tanggal 5 ${closeMonthLabel}.`;
  } else {
    message = `Recap ${monthLabel} bisa diakses mulai tanggal ${targetOpenDay} ${openMonthLabel} sampai tanggal 5 ${closeMonthLabel}.`;
  }

  return {
    isOpen,
    panelVisible: day >= 25 || day <= 5,
    yearMonth: ym(targetYear, targetMonth0),
    monthLabel,
    openDay: targetOpenDay,
    openMonthLabel,
    closeMonthLabel,
    message,
    todayDay: day,
  };
}

/** UTC instant range [start, end) for a given "YYYY-MM" target month in WIB. */
export function getMonthRangeUtc(yearMonth: string): { start: Date; end: Date } {
  const [y, m] = yearMonth.split("-").map(Number);
  const month0 = m - 1;
  // WIB midnight of the 1st -> subtract offset to get UTC instant
  const startWib = Date.UTC(y, month0, 1, 0, 0, 0);
  const endMonth0 = month0 === 11 ? 0 : month0 + 1;
  const endYear = month0 === 11 ? y + 1 : y;
  const endWib = Date.UTC(endYear, endMonth0, 1, 0, 0, 0);
  return {
    start: new Date(startWib - WIB_OFFSET_MS),
    end: new Date(endWib - WIB_OFFSET_MS),
  };
}

/** Previous "YYYY-MM" relative to a given one. */
export function previousYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const month0 = m - 1;
  const prevMonth0 = month0 === 0 ? 11 : month0 - 1;
  const prevYear = month0 === 0 ? y - 1 : y;
  return ym(prevYear, prevMonth0);
}

/** WIB "YYYY-MM-DD" for today (used as the daily cache key). */
export function wibTodayDateStr(now: Date = new Date()): string {
  const w = wibNow(now);
  const y = w.getUTCFullYear();
  const m = String(w.getUTCMonth() + 1).padStart(2, "0");
  const d = String(w.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthLabelFromYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTH_NAMES_ID[m - 1]} ${y}`;
}
