import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { keyDayOverrides, type KeyDayOverride } from "../db/schema.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Current Asia/Jakarta calendar day as YYYY-MM-DD. */
export function wibTodayDateString(now = new Date()): string {
	const wib = new Date(now.getTime() + WIB_OFFSET_MS);
	const y = wib.getUTCFullYear();
	const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
	const d = String(wib.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** UTC Date for midnight WIB of the given YYYY-MM-DD (or today). */
export function wibDayStartUtc(dayWib?: string): Date {
	const day = dayWib || wibTodayDateString();
	const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
	if (!y || !m || !d) return wibDayStartUtc(wibTodayDateString());
	// Midnight WIB = (y-m-d 00:00 WIB) → UTC
	return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - WIB_OFFSET_MS);
}

export function isValidDayWib(day: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(day);
}

export type DayOverrideBonuses = {
	extraDailyInput: number;
	extraDailyOutput: number;
	extraDailyTotal: number;
	extraPromptLimit: number;
	extraRateLimit: number;
};

export function normalizeDayBonuses(raw: Partial<DayOverrideBonuses> | null | undefined): DayOverrideBonuses {
	const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
	return {
		extraDailyInput: n(raw?.extraDailyInput),
		extraDailyOutput: n(raw?.extraDailyOutput),
		extraDailyTotal: n(raw?.extraDailyTotal),
		extraPromptLimit: n(raw?.extraPromptLimit),
		extraRateLimit: n(raw?.extraRateLimit),
	};
}

export function dayOverrideHasAny(b: DayOverrideBonuses): boolean {
	return (
		b.extraDailyInput > 0 ||
		b.extraDailyOutput > 0 ||
		b.extraDailyTotal > 0 ||
		b.extraPromptLimit > 0 ||
		b.extraRateLimit > 0
	);
}

export async function getKeyDayOverride(
	apiKeyId: number,
	dayWib = wibTodayDateString(),
): Promise<KeyDayOverride | null> {
	const [row] = await db
		.select()
		.from(keyDayOverrides)
		.where(and(eq(keyDayOverrides.apiKeyId, apiKeyId), eq(keyDayOverrides.dayWib, dayWib)))
		.limit(1);
	return row || null;
}

/** Apply additive day bonuses onto a resolveAddonQuotaStack result. */
export function applyDayOverrideToQuotaStack<
	T extends {
		dailyInputLimit: number;
		dailyOutputLimit: number;
		inputBase: number;
		outputBase: number;
		effectiveDaily: number;
		bypassIo: boolean;
	},
>(stack: T, ov: DayOverrideBonuses | null | undefined): T {
	if (!ov || !dayOverrideHasAny(ov)) return stack;
	const extraIn = ov.extraDailyInput || 0;
	const extraOut = ov.extraDailyOutput || 0;
	const extraTotal = ov.extraDailyTotal || 0;
	return {
		...stack,
		// Only boost existing caps — never invent a limit when base is unlimited (0).
		dailyInputLimit:
			stack.bypassIo || stack.dailyInputLimit <= 0
				? stack.dailyInputLimit
				: stack.dailyInputLimit + extraIn,
		dailyOutputLimit:
			stack.bypassIo || stack.dailyOutputLimit <= 0
				? stack.dailyOutputLimit
				: stack.dailyOutputLimit + extraOut,
		inputBase: stack.inputBase > 0 ? stack.inputBase + extraIn : stack.inputBase,
		outputBase: stack.outputBase > 0 ? stack.outputBase + extraOut : stack.outputBase,
		effectiveDaily:
			stack.effectiveDaily > 0 ? stack.effectiveDaily + extraTotal : stack.effectiveDaily,
	};
}

export function applyDayOverrideToPromptLimit(limit: number, ov: DayOverrideBonuses | null | undefined): number {
	if (!ov || !ov.extraPromptLimit || limit <= 0) return limit;
	return limit + ov.extraPromptLimit;
}

export function applyDayOverrideToRateLimit(limit: number, ov: DayOverrideBonuses | null | undefined): number {
	if (!ov || !ov.extraRateLimit || limit <= 0) return limit;
	return limit + ov.extraRateLimit;
}
