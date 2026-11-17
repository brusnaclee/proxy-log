/**
 * Amanai credit estimate + catalog (Pricing Engine v3).
 * Docs: https://amanai.sh/docs/billing  https://amanai.sh/docs/models
 * Rates mirrored from GET https://api.amanai.sh/calculate/models (authoritative).
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
	"amanai/claude-fable-5": { mIn: 30, mOut: 150, mCache: 7.5 },
	"amanai/claude-fable-5.1": { mIn: 30, mOut: 150, mCache: 7.5 },
	"amanai/claude-haiku-4.5": { mIn: 3, mOut: 15, mCache: 0.75 },
	"amanai/claude-haiku-5.5": { mIn: 3, mOut: 15, mCache: 0.75 },
	"amanai/claude-opus-4.6": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/claude-opus-4.7": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/claude-opus-4.8": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/claude-opus-5": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/claude-opus-5.5": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/claude-sonnet-4.6": { mIn: 7.5, mOut: 37.5, mCache: 1.875 },
	"amanai/claude-sonnet-5": { mIn: 7.5, mOut: 37.5, mCache: 1.875 },
	"amanai/claude-sonnet-5.5": { mIn: 7.5, mOut: 37.5, mCache: 1.875 },
	"amanai/deepseek-v4-flash": { mIn: 2.5, mOut: 12.5, mCache: 0.625 },
	"amanai/deepseek-v4-flash-0731": { mIn: 2.5, mOut: 12.5, mCache: 0.625 },
	"amanai/deepseek-v4-pro": { mIn: 5, mOut: 25, mCache: 1.25 },
	"amanai/deepseek-v4-pro-0813": { mIn: 5, mOut: 25, mCache: 1.25 },
	"amanai/deepseek-v4.1-flash": { mIn: 2.5, mOut: 12.5, mCache: 0.625 },
	"amanai/deepseek-v4.1-flash-1017": { mIn: 2.5, mOut: 12.5, mCache: 0.625 },
	"amanai/deepseek-v4.1-flash-mod": { mIn: 2.5, mOut: 12.5, mCache: 0.625 },
	"amanai/glm-5.0-turbo": { mIn: 4.8, mOut: 24, mCache: 1.2 },
	"amanai/glm-5.1": { mIn: 5.6, mOut: 28, mCache: 1.4 },
	"amanai/glm-5.2": { mIn: 5.6, mOut: 28, mCache: 1.4 },
	"amanai/glm-5.3": { mIn: 5.6, mOut: 28, mCache: 1.4 },
	"amanai/glm-5.3-flash": { mIn: 2.8, mOut: 14, mCache: 0.7 },
	"amanai/glm-5.3-flash-mod": { mIn: 2.8, mOut: 14, mCache: 0.7 },
	"amanai/glm-5.3-flashx": { mIn: 5.6, mOut: 28, mCache: 1.4 },
	"amanai/glm-5v-turbo": { mIn: 4.8, mOut: 24, mCache: 1.2 },
	"amanai/gpt-5.6-luna": { mIn: 5.625, mOut: 28.125, mCache: 1.40625 },
	"amanai/gpt-5.6-sol": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/gpt-5.6-terra": { mIn: 7.5, mOut: 37.5, mCache: 1.875 },
	"amanai/gpt-6-astra": { mIn: 30, mOut: 150, mCache: 7.5 },
	"amanai/gpt-6-luna": { mIn: 5.625, mOut: 28.125, mCache: 1.40625 },
	"amanai/gpt-6-sol": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/gpt-6.1-sol": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/gpt-6.1-terra": { mIn: 7.5, mOut: 37.5, mCache: 1.875 },
	"amanai/grok-4.5": { mIn: 6, mOut: 30, mCache: 1.5 },
	"amanai/grok-4.6": { mIn: 6, mOut: 30, mCache: 1.5 },
	"amanai/grok-4.7": { mIn: 6, mOut: 30, mCache: 1.5 },
	"amanai/hy3": { mIn: 4.5, mOut: 22.5, mCache: 1.125 },
	"amanai/hy4": { mIn: 4.5, mOut: 22.5, mCache: 1.125 },
	"amanai/kimi-k2.5": { mIn: 2.28, mOut: 11.4, mCache: 0.57 },
	"amanai/kimi-k2.6": { mIn: 3.8, mOut: 19, mCache: 0.95 },
	"amanai/kimi-k2.7": { mIn: 3.8, mOut: 19, mCache: 0.95 },
	"amanai/kimi-k2.8-preview": { mIn: 3.8, mOut: 19, mCache: 0.95 },
	"amanai/kimi-k3": { mIn: 9, mOut: 45, mCache: 2.25 },
	"amanai/kimi-k3.1-pro": { mIn: 6, mOut: 30, mCache: 1.5 },
	"amanai/mimo-v2.6-pro": { mIn: 3.625, mOut: 9.0625, mCache: 0.375 },
	"amanai/mimo-v2.6-pro-mod": { mIn: 3.625, mOut: 9.0625, mCache: 0.375 },
	"amanai/minimax-m2.7": { mIn: 1.2, mOut: 6, mCache: 0.3 },
	"amanai/minimax-m3": { mIn: 2.1, mOut: 10.5, mCache: 0.525 },
	"amanai/minimax-m3.1-flash": { mIn: 1.05, mOut: 5.25, mCache: 0.13125 },
	"amanai/muse-spark-1.1": { mIn: 5, mOut: 25, mCache: 1.25 },
	"amanai/muse-spark-1.2": { mIn: 5, mOut: 25, mCache: 1.25 },
	"amanai/muse-spark-1.3": { mIn: 5, mOut: 25, mCache: 1.25 },
	"amanai/muse-wonder-1.0": { mIn: 10, mOut: 50, mCache: 2.5 },
	"amanai/qwen3.7-max": { mIn: 4.425, mOut: 22.125, mCache: 1.10625 },
	"amanai/qwen3.7-plus": { mIn: 2.24, mOut: 11.2, mCache: 0.56 },
	"amanai/qwen3.8-flash": { mIn: 3, mOut: 15, mCache: 0.75 },
	"amanai/qwen3.8-max": { mIn: 6, mOut: 30, mCache: 1.5 },
};

/** Fallback when model unknown but hop is Compat=amanai — mid-tier GLM-like. */
const FALLBACK_MULTIPLIERS: AmanaiMultipliers = {
	mIn: 6.03472,
	mOut: 30.1736,
	mCache: 0.905208,
};

/**
 * Live rate overlay, refreshed from `GET {endpoint}/calculate/models`.
 *
 * The static table above is a snapshot; Amanai reprices as capacity changes and
 * "the current quote wins". The overlay lets a running process pick up new rates
 * without a redeploy. It never *shrinks* coverage: a model missing from the live
 * catalog keeps its static row, so a partial/failed fetch cannot silently zero
 * out billing for a model we already know.
 */
const liveRates = new Map<string, AmanaiMultipliers>();
let liveRatesFetchedAt = 0;
let liveRatesEndpoint = "";

export function getLiveRatesMeta(): {
	count: number;
	fetchedAt: number;
	endpoint: string;
} {
	return {
		count: liveRates.size,
		fetchedAt: liveRatesFetchedAt,
		endpoint: liveRatesEndpoint,
	};
}

/** Test hook / admin reset. */
export function clearLiveRates(): void {
	liveRates.clear();
	liveRatesFetchedAt = 0;
	liveRatesEndpoint = "";
}

/**
 * Pull the authoritative rate sheet. Best-effort: never throws, never clears
 * existing entries on failure (a transient 502 must not wipe billing rates).
 */
export async function refreshAmanaiLiveRates(opts: {
	endpoint: string;
	apiKey: string;
	timeoutMs?: number;
}): Promise<{ updated: number; error?: string }> {
	const base = String(opts.endpoint || "").replace(/\/+$/, "");
	const key = String(opts.apiKey || "").trim();
	if (!base || !key) return { updated: 0, error: "missing endpoint or key" };

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
	try {
		const res = await fetch(`${base.replace(/\/v1$/, "")}/calculate/models`, {
			headers: { Authorization: `Bearer ${key}` },
			signal: ctrl.signal,
		});
		if (!res.ok) return { updated: 0, error: `HTTP ${res.status}` };
		const raw: any = await res.json();
		const list: any[] = Array.isArray(raw)
			? raw
			: Array.isArray(raw?.data)
				? raw.data
				: Array.isArray(raw?.models)
					? raw.models
					: [];
		if (list.length === 0) return { updated: 0, error: "empty catalog" };

		let updated = 0;
		for (const m of list) {
			const id = String(m?.id || "").trim();
			const mIn = Number(m?.m_in);
			const mOut = Number(m?.m_out);
			const mCache = Number(m?.m_cache);
			// Only chat-shaped rows carry all three finite rates. Embeddings /
			// rerank / media use per-token or per-unit pricing with minimums and
			// must not be treated as chat multipliers.
			if (!id || !Number.isFinite(mIn) || !Number.isFinite(mOut)) continue;
			if (!Number.isFinite(mCache)) continue;
			liveRates.set(id, { mIn, mOut, mCache });
			updated += 1;
		}
		if (updated > 0) {
			liveRatesFetchedAt = Date.now();
			liveRatesEndpoint = base;
		}
		return { updated };
	} catch (err: any) {
		return { updated: 0, error: err?.message || String(err) };
	} finally {
		clearTimeout(timer);
	}
}

export function resolveAmanaiMultipliers(model: string): AmanaiMultipliers | null {
	let id = String(model || "").trim();
	if (!id) return null;
	// auto (provider/model) [stream] → inner model id
	const autoMatch = id.match(/^auto\s*\(([^)]+)\)/i);
	if (autoMatch) id = autoMatch[1].trim();

	// Live overlay wins (current quote). Falls through to the static snapshot
	// when the live catalog has not loaded or does not list this model.
	const lookup = (candidate: string): AmanaiMultipliers | null => {
		const live = liveRates.get(candidate);
		if (live) return live;
		return AMANAI_MODEL_MULTIPLIERS[candidate] || null;
	};

	const direct = lookup(id);
	if (direct) return direct;

	for (const k of new Set([...liveRates.keys(), ...Object.keys(AMANAI_MODEL_MULTIPLIERS)])) {
		const v = lookup(k);
		if (!v) continue;
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

/**
 * IMPORTANT — promptTokens here must be BILLABLE (uncached) input, i.e.
 * (upstream prompt_tokens − cache_read_tokens). request_logs.prompt_tokens is
 * stored billable, so log rows are correct. Callers holding the raw upstream
 * prompt_tokens must subtract cachedTokens first, otherwise cached input is
 * billed twice (once at m_in, once at m_cache) and we over-report credits.
 */
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
