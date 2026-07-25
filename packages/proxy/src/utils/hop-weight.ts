/**
 * Daily/monthly INPUT limit hop weights (output always 100%).
 * Logs still store full tokens; this only affects limit credit + aligned UIs.
 */

export type TokenLimitWeightMode =
	| "first_rest_flat" // hop1=100%, hops 2+=flat%
	| "flat_all" // every hop = flat%
	| "peak" // MAX(prompt+cache) once per turn
	| "full" // every hop 100% (amanai-style for limits)
	| "custom"; // ranges { fromHop, toHop, percent }

export type HopWeightRange = {
	fromHop: number;
	toHop: number;
	percent: number;
};

export function normalizeTokenLimitWeightMode(raw: unknown): TokenLimitWeightMode {
	const m = String(raw || "first_rest_flat").toLowerCase().trim();
	if (m === "flat_all" || m === "flat") return "flat_all";
	if (m === "peak" || m === "per_turn_peak") return "peak";
	if (m === "full") return "full";
	if (m === "custom") return "custom";
	if (m === "graduated") return "first_rest_flat"; // old fixed schedule → new default
	return "first_rest_flat";
}

export function normalizeTokenLimitWeightPercent(raw: unknown): number {
	const n = Math.round(Number(raw));
	if (!Number.isFinite(n)) return 10;
	return Math.max(0, Math.min(100, n));
}

export function normalizeHopWeightRanges(raw: unknown): HopWeightRange[] {
	let arr: unknown = raw;
	if (typeof raw === "string") {
		try {
			arr = JSON.parse(raw || "[]");
		} catch {
			return [];
		}
	}
	if (!Array.isArray(arr)) return [];
	const out: HopWeightRange[] = [];
	for (const row of arr) {
		if (!row || typeof row !== "object") continue;
		const fromHop = Math.max(1, Math.floor(Number((row as any).fromHop ?? (row as any).from)));
		const toHop = Math.max(fromHop, Math.floor(Number((row as any).toHop ?? (row as any).to ?? fromHop)));
		const percent = normalizeTokenLimitWeightPercent((row as any).percent ?? (row as any).pct);
		if (!Number.isFinite(fromHop) || !Number.isFinite(toHop)) continue;
		out.push({ fromHop, toHop, percent });
	}
	out.sort((a, b) => a.fromHop - b.fromHop || a.toHop - b.toHop);
	return out;
}

export function serializeHopWeightRanges(ranges: HopWeightRange[]): string {
	return JSON.stringify(normalizeHopWeightRanges(ranges));
}

/** Pure JS weight % for tests / previews. */
export function inputLimitWeightPercentForHop(
	rn: number,
	mode: TokenLimitWeightMode,
	flatPercent: number,
	ranges: HopWeightRange[] = [],
): number {
	const n = Math.floor(Number(rn));
	if (!Number.isFinite(n) || n <= 0) return 100;
	const flat = normalizeTokenLimitWeightPercent(flatPercent);

	if (mode === "peak") return n === 1 ? 100 : 0; // informational only; peak uses different SQL
	if (mode === "full") return 100;
	if (mode === "flat_all") return flat;
	if (mode === "custom") {
		for (const r of ranges) {
			if (n >= r.fromHop && n <= r.toHop) return r.percent;
		}
		return 0;
	}
	// first_rest_flat
	if (n === 1) return 100;
	return flat;
}
