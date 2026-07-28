/**
 * Global model_limits rows with prompt_limit > 0 — source of truth for non-addon tease caps.
 * Admin edits via Settings → Model Limit Overrides; UI/Discord read the same rows.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { modelLimits } from "../db/schema.js";
import { patternMatchVariants } from "./rate-limit.js";

type TeaseRow = typeof modelLimits.$inferSelect;

let cache: TeaseRow[] = [];

export async function refreshTeaseLimitsCacheFromDb(): Promise<void> {
	const rows = await db
		.select()
		.from(modelLimits)
		.where(and(eq(modelLimits.scope, "global"), eq(modelLimits.scopeId, 0)));
	syncTeaseLimitsCache(rows);
}

export function syncTeaseLimitsCache(rows: TeaseRow[]): void {
	cache = rows.filter((r) => r.scope === "global" && r.scopeId === 0 && (r.promptLimit || 0) > 0);
}

function modelMatchesTeaseRow(normalizedModel: string, row: TeaseRow): boolean {
	const lower = normalizedModel.toLowerCase();
	const stored = (row.model || "").toLowerCase().trim();
	if (!stored) return false;
	if (row.isPattern) {
		const variants = patternMatchVariants(stored);
		return variants.some((v) => lower.includes(v) || v.includes(lower));
	}
	if (stored === lower) return true;
	if (stored.endsWith("/" + lower)) return true;
	if (lower.endsWith("/" + stored)) return true;
	const base = stored.includes("/") ? stored.slice(stored.lastIndexOf("/") + 1) : stored;
	return base === lower;
}

/** Sync lookup — used by proxy gates when no per-key override matched yet. */
export function getTeaseLimitForModel(model: string): number {
	const lower = (model || "").toLowerCase().trim();
	if (!lower || !cache.length) return 0;
	let best: TeaseRow | null = null;
	for (const row of cache) {
		if (!modelMatchesTeaseRow(lower, row)) continue;
		const patLen = (row.model || "").length;
		if (!best || patLen > (best.model || "").length) best = row;
	}
	return best?.promptLimit || 0;
}

export function isTeaseModelFromLimits(model: string): boolean {
	return getTeaseLimitForModel(model) > 0;
}

export function listTeaseLimitRows(): Array<{ model: string; promptLimit: number; isPattern: boolean }> {
	return cache.map((r) => ({
		model: r.model,
		promptLimit: r.promptLimit || 0,
		isPattern: !!r.isPattern,
	}));
}
