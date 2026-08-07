/**
 * Best-effort Amanai GET /v1/usage enrich for Compat hops.
 * Uses provider API key from DB only — never hardcode. Never throws to callers.
 *
 * Prefer Amanai recent (cache_read + credits) as billing truth when response
 * usage omits cache fields (common on GLM/DeepSeek OpenAI path).
 */
import { db } from "../db/index.js";
import { providerApiKeys, providers, requestLogs } from "../db/schema.js";
import { and, desc, eq, gte } from "drizzle-orm";
import { computeUpstreamCreditPartsForHop } from "./amanai-credits.js";

type UsageRecent = {
	ts?: number;
	public_model?: string;
	input_tokens?: number;
	output_tokens?: number;
	cache_read_tokens?: number;
	credits?: number;
	status?: string;
};

function modelNeedle(model: string): string {
	const m = String(model || "").toLowerCase();
	const parts = m.split("/").filter(Boolean);
	return parts[parts.length - 1] || m;
}

async function resolveProviderApiKey(providerId: number | null | undefined): Promise<string | null> {
	if (!providerId) return null;
	try {
		const rows = await db
			.select({ apiKey: providerApiKeys.apiKey })
			.from(providerApiKeys)
			.where(and(eq(providerApiKeys.providerId, providerId), eq(providerApiKeys.isActive, true)))
			.orderBy(desc(providerApiKeys.id))
			.limit(1);
		if (rows[0]?.apiKey) return String(rows[0].apiKey).trim();
		const prov = await db
			.select({ apiKey: providers.apiKey })
			.from(providers)
			.where(eq(providers.id, providerId))
			.limit(1);
		const k = prov[0]?.apiKey ? String(prov[0].apiKey).trim() : "";
		return k || null;
	} catch {
		return null;
	}
}

async function fetchAmanaiUsageRecent(apiKey: string): Promise<UsageRecent[]> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 4000);
	try {
		const res = await fetch("https://api.amanai.dev/v1/usage", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: ctrl.signal,
		});
		if (!res.ok) return [];
		const raw = (await res.json()) as { recent?: UsageRecent[] };
		return Array.isArray(raw.recent) ? raw.recent : [];
	} catch {
		return [];
	} finally {
		clearTimeout(t);
	}
}

function scoreMatch(
	r: UsageRecent,
	opts: { needle: string; promptTokens: number; completionTokens: number; nowSec: number },
): number {
	if (r.status && r.status !== "ok") return -1;
	const pm = String(r.public_model || "").toLowerCase();
	const bare = pm.split("/").pop() || "";
	if (!pm.includes(opts.needle) && !opts.needle.includes(bare)) return -1;
	const ts = Number(r.ts) || 0;
	if (ts && Math.abs(ts - opts.nowSec) > 180) return -1;
	const input = Math.max(0, Number(r.input_tokens) || 0);
	const out = Math.max(0, Number(r.output_tokens) || 0);
	const cacheRead = Math.max(0, Number(r.cache_read_tokens) || 0);
	// Amanai input is usually full prompt (incl. cache); our stored prompt may be uncached.
	const fullGuess = Math.max(opts.promptTokens + (opts.promptTokens > 0 ? 0 : 0), opts.promptTokens);
	const candidates = [input, Math.max(0, input - cacheRead), input + cacheRead];
	let bestTok = Infinity;
	for (const c of candidates) {
		bestTok = Math.min(bestTok, Math.abs(c - fullGuess), Math.abs(c - (fullGuess + cacheRead)));
	}
	// Also compare against prompt+typical cache if we already had a guess
	bestTok = Math.min(bestTok, Math.abs(input - opts.promptTokens));
	const outDelta = Math.abs(out - opts.completionTokens);
	const tsDelta = ts ? Math.abs(ts - opts.nowSec) : 60;
	// Lower is better
	return bestTok + outDelta * 2 + tsDelta;
}

/**
 * After a Compat hop, pull cache_read + credits from Amanai recent and patch the log.
 * Runs even when response already reported cached_tokens — API credits win.
 */
export function scheduleAmanaiUsageEnrich(opts: {
	logId?: number | null;
	providerId?: number | null;
	model: string;
	promptTokens: number;
	completionTokens: number;
	cachedTokens?: number;
	createdAtMs?: number;
}): void {
	const { providerId, model } = opts;
	if (!providerId) return;
	void (async () => {
		try {
			const key = await resolveProviderApiKey(providerId);
			if (!key) return;
			// Small delay so Amanai recent includes this hop
			await new Promise((r) => setTimeout(r, 1500));
			const recent = await fetchAmanaiUsageRecent(key);
			if (!recent.length) return;
			const needle = modelNeedle(model);
			const nowSec = Math.floor((opts.createdAtMs || Date.now()) / 1000);
			let best: UsageRecent | null = null;
			let bestScore = Infinity;
			for (const r of recent) {
				const s = scoreMatch(r, {
					needle,
					promptTokens: opts.promptTokens,
					completionTokens: opts.completionTokens,
					nowSec,
				});
				if (s < 0) continue;
				if (s < bestScore) {
					bestScore = s;
					best = r;
				}
			}
			if (!best || bestScore > 8000) return;

			const cacheRead = Math.max(0, Number(best.cache_read_tokens) || 0);
			const apiCredits = Math.max(0, Number(best.credits) || 0);
			const input = Math.max(0, Number(best.input_tokens) || 0);
			const completion = Math.max(0, Number(best.output_tokens) || opts.completionTokens || 0);

			// Prefer Amanai semantics: input ≈ full; cache_read ⊆ input
			let billable = Math.max(0, opts.promptTokens);
			if (cacheRead > 0 && input > 0) {
				billable = input >= cacheRead ? Math.max(0, input - cacheRead) : billable;
			} else if (input > 0 && cacheRead === 0) {
				// No cache on Amanai — billable = full input from API
				billable = input;
			}

			const parts = computeUpstreamCreditPartsForHop({
				model,
				promptTokens: billable,
				cachedTokens: cacheRead,
				completionTokens: completion,
				amanaiCompat: true,
			});
			const credits = apiCredits > 0 ? apiCredits : parts.total;
			const outCredits = Math.min(credits, parts.outCredits);

			// Nothing useful to write
			if (cacheRead <= 0 && apiCredits <= 0) return;

			const patch: Record<string, number> = {
				upstreamCredits: credits,
				upstreamCreditsOut: outCredits,
			};
			if (cacheRead > 0) {
				patch.cachedTokens = cacheRead;
				patch.promptTokens = billable;
			} else if (apiCredits > 0 && input > 0) {
				// Sync credits even without cache; keep token fields unless clearly full-priced miss
				patch.promptTokens = billable;
				if ((opts.cachedTokens || 0) > 0 && cacheRead === 0) {
					// Response claimed cache but Amanai billed 0 — clear false cache
					patch.cachedTokens = 0;
				}
			}

			if (opts.logId) {
				await db.update(requestLogs).set(patch).where(eq(requestLogs.id, opts.logId));
				return;
			}
			const since = new Date(Date.now() - 3 * 60 * 1000);
			const rows = await db
				.select({ id: requestLogs.id })
				.from(requestLogs)
				.where(and(gte(requestLogs.createdAt, since), eq(requestLogs.model, model)))
				.orderBy(desc(requestLogs.id))
				.limit(1);
			if (rows[0]?.id) {
				await db.update(requestLogs).set(patch).where(eq(requestLogs.id, rows[0].id));
			}
		} catch (err) {
			console.warn("[amanai-usage-sync] enrich failed:", (err as Error)?.message || err);
		}
	})();
}
