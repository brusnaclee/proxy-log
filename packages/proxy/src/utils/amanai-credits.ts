/**
 * Amanai credit estimate for verification tables (does NOT change user quotas).
 * Formula: https://ai.amanai.dev/docs/billing/
 *   credits = ceil( (input - cache_read)*m_in + cache_read*m_cache + output*m_out )
 *   m_cache = 0.25 * m_in ; min 1000 credits per successful hop
 */

export type AmanaiMultipliers = { mIn: number; mOut: number; mCache: number };

/** Snapshot of catalog rates (Pricing v3). Update when Amanai changes multipliers. */
export const AMANAI_MODEL_MULTIPLIERS: Record<string, AmanaiMultipliers> = {
	"amanai/glm-5.2": { mIn: 6.03472, mOut: 30.1736, mCache: 0.905208 },
	"amanai/gpt-5.4-mini": { mIn: 2.9, mOut: 14.5, mCache: 0.435 },
	"amanai/gpt-5.4": { mIn: 3.1, mOut: 15.5, mCache: 0.465 },
	"amanai/claude-haiku-4.5": { mIn: 5.499705, mOut: 27.498525, mCache: 0.824956 },
	"amanai/claude-sonnet-4.6": { mIn: 12.099791, mOut: 60.498955, mCache: 1.814969 },
	"amanai/qwen3.8-max-preview": { mIn: 6.03472, mOut: 30.1736, mCache: 0.905208 },
	"amanai/deepseek-v4-flash": { mIn: 1.5705, mOut: 7.8525, mCache: 0.235575 },
	"amanai/deepseek-v4-flash-0731": { mIn: 1.5705, mOut: 7.8525, mCache: 0.235575 },
};

export function resolveAmanaiMultipliers(model: string): AmanaiMultipliers | null {
	const id = String(model || "").trim();
	if (!id) return null;
	if (AMANAI_MODEL_MULTIPLIERS[id]) return AMANAI_MODEL_MULTIPLIERS[id];
	// Client ids like phantom/amanai/glm-5.2 or amanai/glm-5.2
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
	const billableIn = Math.max(0, Number(opts.promptTokens) || 0);
	const cached = Math.max(0, Number(opts.cachedTokens) || 0);
	const out = Math.max(0, Number(opts.completionTokens) || 0);
	const mCache = opts.mCache != null ? opts.mCache : opts.mIn * 0.25;
	const raw = billableIn * opts.mIn + cached * mCache + out * opts.mOut;
	const credits = Math.ceil(raw);
	const floor = opts.minCredits != null ? opts.minCredits : 1000;
	return Math.max(floor, credits);
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
