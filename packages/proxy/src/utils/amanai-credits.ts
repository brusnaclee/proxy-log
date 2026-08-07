/**
 * Amanai credit estimate + catalog (Pricing Engine v3).
 * Docs: https://ai.amanai.dev/docs/billing/ https://ai.amanai.dev/docs/models/
 *
 *   credits = ceil( (input - cache_read)*m_in + cache_read*m_cache + output*m_out )
 *   m_cache = 0.25 * m_in ; min 1000 credits per successful hop
 *
 * For Compat=amanai providers, upstream_credits is also the local input meter
 * (anti-boncos). Does not apply local INPUT_TOKEN_MULTIPLIER on top.
 */

export type AmanaiMultipliers = { mIn: number; mOut: number; mCache: number };

/** Snapshot of catalog rates (Pricing v3). Update when Amanai changes multipliers. */
export const AMANAI_MODEL_MULTIPLIERS: Record<string, AmanaiMultipliers> = {
	"amanai/glm-5.2": { mIn: 6.03472, mOut: 30.1736, mCache: 0.905208 },
	"amanai/glm-5.1": { mIn: 4.2273, mOut: 21.1365, mCache: 0.634095 },
	"amanai/glm-5.0": { mIn: 3.0195, mOut: 15.0975, mCache: 0.452925 },
	"amanai/glm-5.0-turbo": { mIn: 3.6234, mOut: 18.117, mCache: 0.54351 },
	"amanai/glm-5v-turbo": { mIn: 4.2273, mOut: 21.1365, mCache: 0.634095 },
	"amanai/qwen3.8-max-preview": { mIn: 6.03472, mOut: 30.1736, mCache: 0.905208 },
	"amanai/qwen3.7-max": { mIn: 4.228166, mOut: 21.14083, mCache: 0.634225 },
	"amanai/qwen3.7-plus": { mIn: 3.500107, mOut: 17.500535, mCache: 0.525016 },
	"amanai/qwen-lite": { mIn: 0.003017, mOut: 0.015085, mCache: 0.000453 },
	"amanai/kimi-k3": { mIn: 15.08675, mOut: 75.43375, mCache: 2.263012 },
	"amanai/kimi-k2.7": { mIn: 6.49755, mOut: 32.48775, mCache: 0.974633 },
	"amanai/kimi-k2.6": { mIn: 4.34625, mOut: 21.73125, mCache: 0.651938 },
	"amanai/kimi-k2.5": { mIn: 3.88875, mOut: 19.44375, mCache: 0.583313 },
	"amanai/deepseek-v4-pro": { mIn: 3.0195, mOut: 15.0975, mCache: 0.452925 },
	"amanai/deepseek-v4-flash": { mIn: 1.5705, mOut: 7.8525, mCache: 0.235575 },
	"amanai/deepseek-v4-flash-0731": { mIn: 1.5705, mOut: 7.8525, mCache: 0.235575 },
	"amanai/minimax-m3": { mIn: 2.67705, mOut: 13.38525, mCache: 0.401557 },
	"amanai/minimax-m2.7": { mIn: 1.8117, mOut: 9.0585, mCache: 0.271755 },
	"amanai/hy3-preview": { mIn: 3.32145, mOut: 16.60725, mCache: 0.498217 },
	"amanai/grok-4.5": { mIn: 5.73705, mOut: 28.68525, mCache: 0.860557 },
	"amanai/grok-4.20": { mIn: 3.66, mOut: 18.3, mCache: 0.549 },
	"amanai/gpt-5.4-mini": { mIn: 2.9, mOut: 14.5, mCache: 0.435 },
	"amanai/gpt-5.4": { mIn: 3.1, mOut: 15.5, mCache: 0.465 },
	"amanai/gpt-5.5": { mIn: 4.3, mOut: 21.5, mCache: 0.645 },
	"amanai/gpt-5.6-sol": { mIn: 6.34095, mOut: 31.70475, mCache: 0.951143 },
	"amanai/gpt-5.6-terra": { mIn: 5.97495, mOut: 29.87475, mCache: 0.896242 },
	"amanai/gpt-5.6-luna": { mIn: 6.15795, mOut: 30.78975, mCache: 0.923692 },
	"amanai/claude-fable-5": { mIn: 36.299373, mOut: 181.496865, mCache: 5.444906 },
	"amanai/claude-opus-5": { mIn: 18.149686, mOut: 90.74843, mCache: 2.722453 },
	"amanai/claude-opus-4.8": { mIn: 18.149686, mOut: 90.74843, mCache: 2.722453 },
	"amanai/claude-opus-4.7": { mIn: 18.149686, mOut: 90.74843, mCache: 2.722453 },
	"amanai/claude-opus-4.6": { mIn: 18.149686, mOut: 90.74843, mCache: 2.722453 },
	"amanai/claude-sonnet-5": { mIn: 12.099791, mOut: 60.498955, mCache: 1.814969 },
	"amanai/claude-sonnet-4.6": { mIn: 12.099791, mOut: 60.498955, mCache: 1.814969 },
	"amanai/claude-haiku-4.5": { mIn: 5.499705, mOut: 27.498525, mCache: 0.824956 },
};

/** Fallback when model unknown but hop is Compat=amanai — mid-tier GLM-like. */
const FALLBACK_MULTIPLIERS: AmanaiMultipliers = {
	mIn: 6.03472,
	mOut: 30.1736,
	mCache: 0.905208,
};

export function resolveAmanaiMultipliers(model: string): AmanaiMultipliers | null {
	let id = String(model || "").trim();
	if (!id) return null;
	// auto (provider/model) [stream] → inner model id
	const autoMatch = id.match(/^auto\s*\(([^)]+)\)/i);
	if (autoMatch) id = autoMatch[1].trim();
	if (AMANAI_MODEL_MULTIPLIERS[id]) return AMANAI_MODEL_MULTIPLIERS[id];
	for (const [k, v] of Object.entries(AMANAI_MODEL_MULTIPLIERS)) {
		if (id === k || id.endsWith(`/${k}`) || id.endsWith(k)) return v;
		const bare = k.includes("/") ? k.slice(k.lastIndexOf("/") + 1) : k;
		if (id === bare || id.endsWith(`/${bare}`)) return v;
	}
	return null;
}

export function estimateAmanaiCredits(opts: {
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	mIn: number;
	mOut: number;
	mCache?: number;
	minCredits?: number;
}): number {
	return estimateAmanaiCreditParts(opts).total;
}

/**
 * Split Pricing v3 credits into input vs output parts so UI/gates can show
 * Total = Input + Output (same units). Floor applies to the combined total;
 * leftover floor is attributed to input.
 */
export function estimateAmanaiCreditParts(opts: {
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	mIn: number;
	mOut: number;
	mCache?: number;
	minCredits?: number;
}): { total: number; inCredits: number; outCredits: number } {
	const billableIn = Math.max(0, Number(opts.promptTokens) || 0);
	const cached = Math.max(0, Number(opts.cachedTokens) || 0);
	const out = Math.max(0, Number(opts.completionTokens) || 0);
	const mCache = opts.mCache != null ? opts.mCache : opts.mIn * 0.25;
	const rawIn = billableIn * opts.mIn + cached * mCache;
	const rawOut = out * opts.mOut;
	const floor = opts.minCredits != null ? opts.minCredits : 1000;
	const total = Math.max(floor, Math.ceil(rawIn + rawOut));
	const outCredits = Math.min(total, Math.ceil(rawOut));
	const inCredits = total - outCredits;
	return { total, inCredits, outCredits };
}

/** promptTokens here = billable (uncached) as stored in request_logs. */
export function estimateAmanaiCreditsForLogRow(row: {
	model?: string | null;
	promptTokens?: number | null;
	cachedTokens?: number | null;
	completionTokens?: number | null;
}): { credits: number; multipliers: AmanaiMultipliers | null } {
	const multipliers = resolveAmanaiMultipliers(String(row.model || ""));
	if (!multipliers) {
		return { credits: 0, multipliers: null };
	}
	return {
		credits: estimateAmanaiCredits({
			promptTokens: Number(row.promptTokens) || 0,
			cachedTokens: Number(row.cachedTokens) || 0,
			completionTokens: Number(row.completionTokens) || 0,
			mIn: multipliers.mIn,
			mOut: multipliers.mOut,
			mCache: multipliers.mCache,
		}),
		multipliers,
	};
}

/**
 * Credits to store on Compat=amanai hops (always > 0 when tokens present).
 * Uses catalog rates; unknown models fall back to mid-tier multipliers.
 */
export function computeUpstreamCreditsForHop(opts: {
	model: string;
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	/** When false, returns 0 (non-amanai provider). */
	amanaiCompat: boolean;
}): number {
	return computeUpstreamCreditPartsForHop(opts).total;
}

/** Total + output-part credits for Compat=amanai hops (input-part = total − out). */
export function computeUpstreamCreditPartsForHop(opts: {
	model: string;
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	amanaiCompat: boolean;
}): { total: number; inCredits: number; outCredits: number } {
	if (!opts.amanaiCompat) return { total: 0, inCredits: 0, outCredits: 0 };
	const prompt = Math.max(0, Number(opts.promptTokens) || 0);
	const cached = Math.max(0, Number(opts.cachedTokens) || 0);
	const completion = Math.max(0, Number(opts.completionTokens) || 0);
	if (prompt + cached + completion <= 0) return { total: 0, inCredits: 0, outCredits: 0 };
	const multipliers = resolveAmanaiMultipliers(opts.model) || FALLBACK_MULTIPLIERS;
	return estimateAmanaiCreditParts({
		promptTokens: prompt,
		cachedTokens: cached,
		completionTokens: completion,
		mIn: multipliers.mIn,
		mOut: multipliers.mOut,
		mCache: multipliers.mCache,
	});
}
