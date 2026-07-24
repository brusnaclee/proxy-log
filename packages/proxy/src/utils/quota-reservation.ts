/**
 * In-memory prompt-turn reservations to close the race where concurrent
 * requests all read the same DB DISTINCT turn_id count before inserts flush
 * (async log writer), allowing per-model / global prompt caps to be exceeded.
 *
 * Node is single-threaded: check DB → tryReserve is atomic vs other requests
 * after each await returns.
 */

type BucketState = {
	turnIds: Set<string>;
	/** Drop reservations older than this (sliding window). */
	windowMs: number;
	/** turnId → reservedAt ms */
	reservedAt: Map<string, number>;
};

const buckets = new Map<string, BucketState>();

function prune(state: BucketState, now: number): void {
	for (const [id, at] of state.reservedAt) {
		if (now - at >= state.windowMs) {
			state.reservedAt.delete(id);
			state.turnIds.delete(id);
		}
	}
}

export function modelPromptBucketKey(
	apiKeyIds: number[],
	bucket: string,
): string {
	const ids = [...apiKeyIds].filter((n) => n > 0).sort((a, b) => a - b);
	return `m:${ids.join(",")}:${bucket}`;
}

export function globalPromptBucketKey(apiKeyIds: number[]): string {
	const ids = [...apiKeyIds].filter((n) => n > 0).sort((a, b) => a - b);
	return `g:${ids.join(",")}`;
}

/** How many reserved turns still fall inside the sliding window. */
export function countReserved(scopeKey: string, windowMs: number): number {
	const state = buckets.get(scopeKey);
	if (!state) return 0;
	const now = Date.now();
	state.windowMs = windowMs;
	prune(state, now);
	return state.turnIds.size;
}

/**
 * Reserve a turn id after a successful DB check.
 * Returns false if dbUsed + already-reserved would exceed limit (without this turn).
 */
export function tryReserveTurn(opts: {
	scopeKey: string;
	turnId: string;
	limit: number;
	dbUsed: number;
	windowMs: number;
}): boolean {
	const { scopeKey, turnId, limit, dbUsed, windowMs } = opts;
	if (limit <= 0 || !turnId) return true;

	let state = buckets.get(scopeKey);
	if (!state) {
		state = { turnIds: new Set(), reservedAt: new Map(), windowMs };
		buckets.set(scopeKey, state);
	}
	state.windowMs = windowMs;
	const now = Date.now();
	prune(state, now);

	if (state.turnIds.has(turnId)) return true; // already reserved (retry)

	if (dbUsed + state.turnIds.size >= limit) return false;

	state.turnIds.add(turnId);
	state.reservedAt.set(turnId, now);
	return true;
}

export function hasReservedTurn(scopeKey: string, turnId: string | null | undefined): boolean {
	if (!turnId) return false;
	const state = buckets.get(scopeKey);
	if (!state) return false;
	prune(state, Date.now());
	return state.turnIds.has(turnId);
}

/** Ms until next midnight Asia/Jakarta (WIB, UTC+7). */
export function msUntilNextWibMidnight(nowMs = Date.now()): number {
	const wibOffset = 7 * 60 * 60 * 1000;
	const wibNow = new Date(nowMs + wibOffset);
	const next = new Date(wibNow);
	next.setUTCHours(24, 0, 0, 0);
	return Math.max(0, next.getTime() - wibOffset - nowMs);
}

export function formatResetEta(resetMs: number): string {
	const mins = Math.max(1, Math.ceil(resetMs / 60_000));
	const at = new Date(Date.now() + resetMs);
	const wib = new Date(at.getTime() + 7 * 60 * 60 * 1000);
	const hh = String(wib.getUTCHours()).padStart(2, "0");
	const mm = String(wib.getUTCMinutes()).padStart(2, "0");
	return `Resets in ~${mins} minute(s) (≈ ${hh}:${mm} WIB)`;
}
