/**
 * Best-effort Amanai GET /v1/usage enrich for OpenAI hops that omit cache fields.
 * Uses provider API key from DB only — never hardcode. Never throws to callers.
 */
import { db } from "../db/index.js";
import { providerApiKeys, providers, requestLogs } from "../db/schema.js";
import { and, desc, eq, gte } from "drizzle-orm";
import { computeUpstreamCreditsForHop } from "./amanai-credits.js";

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

/**
 * After an OpenAI-path hop with cached_tokens=0, try to pull cache_read + credits
 * from Amanai recent activity and patch the log row.
 */
export function scheduleAmanaiUsageEnrich(opts: {
	logId?: number | null;
	providerId?: number | null;
	model: string;
	promptTokens: number;
	completionTokens: number;
	createdAtMs?: number;
}): void {
	const { providerId, model } = opts;
	if (!providerId) return;
	void (async () => {
		try {
			const key = await resolveProviderApiKey(providerId);
			if (!key) return;
			// Small delay so Amanai recent includes this hop
			await new Promise((r) => setTimeout(r, 1200));
			const recent = await fetchAmanaiUsageRecent(key);
			if (!recent.length) return;
			const needle = modelNeedle(model);
			const nowSec = Math.floor((opts.createdAtMs || Date.now()) / 1000);
			const match = recent.find((r) => {
				if (r.status && r.status !== "ok") return false;
				const pm = String(r.public_model || "").toLowerCase();
				if (!pm.includes(needle) && !needle.includes(pm.split("/").pop() || "")) return false;
				const ts = Number(r.ts) || 0;
				if (ts && Math.abs(ts - nowSec) > 120) return false;
				return true;
			});
			if (!match) return;
			const cacheRead = Math.max(0, Number(match.cache_read_tokens) || 0);
			const apiCredits = Math.max(0, Number(match.credits) || 0);
			const input = Math.max(0, Number(match.input_tokens) || 0);
			// Anthropic-style: input often = uncached remainder when cache present
			const billable =
				cacheRead > 0 && input > 0
					? Math.max(0, input - cacheRead) > 0
						? Math.max(0, input - cacheRead)
						: Math.max(0, opts.promptTokens)
					: Math.max(0, opts.promptTokens);
			// Prefer API credits when present; else recompute with enriched cache
			const credits =
				apiCredits > 0
					? apiCredits
					: computeUpstreamCreditsForHop({
							model,
							promptTokens: billable,
							cachedTokens: cacheRead,
							completionTokens: Math.max(0, Number(match.output_tokens) || opts.completionTokens || 0),
							amanaiCompat: true,
						});
			if (cacheRead <= 0 && apiCredits <= 0) return;

			const patch: Record<string, number> = { upstreamCredits: credits };
			if (cacheRead > 0) {
				patch.cachedTokens = cacheRead;
				// Keep prompt as uncached remainder when Amanai input looks like total
				if (input > cacheRead) {
					patch.promptTokens = Math.max(0, input - cacheRead);
				}
			}

			if (opts.logId) {
				await db.update(requestLogs).set(patch).where(eq(requestLogs.id, opts.logId));
				return;
			}
			// Fallback: newest matching row in last 3 minutes
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
