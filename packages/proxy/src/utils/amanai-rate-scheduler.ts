/**
 * Amanai rate-sheet scheduler.
 *
 * Amanai reprices models as capacity changes and bills at "the current quote".
 * The static multiplier table in `amanai-credits.ts` is only a snapshot, so a
 * long-running proxy drifts: it over-reports credits on models that got cheaper
 * and, worse, under-reports on models that got more expensive (we absorb the
 * difference). This scheduler keeps the live overlay fresh.
 *
 * Design constraints:
 *  - Best-effort. A failed refresh must never throw into the boot path or wipe
 *    the rates we already have.
 *  - Only amanai-compat providers with an active key are polled.
 *  - Cheap: one GET per provider per cycle, unref'd timer, 30s boot delay so it
 *    does not compete with schema migration / model-catalog seeding.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { providerApiKeys, providers } from "../db/schema.js";
import { providerIsAmanaiCompat } from "./amanai-compat.js";
import { refreshAmanaiLiveRates, getLiveRatesMeta } from "./amanai-credits.js";

const REFRESH_INTERVAL_MS = Number(
	process.env.AMANAI_RATE_REFRESH_MS || 6 * 60 * 60 * 1000,
); // 6h
const BOOT_DELAY_MS = Number(process.env.AMANAI_RATE_BOOT_DELAY_MS || 30_000);

let started = false;

async function resolveProviderKey(providerId: number): Promise<string | null> {
	try {
		const rows = await db
			.select({ apiKey: providerApiKeys.apiKey })
			.from(providerApiKeys)
			.where(
				eq(providerApiKeys.providerId, providerId),
			)
			.limit(1);
		const k = rows[0]?.apiKey ? String(rows[0].apiKey).trim() : "";
		if (k) return k;
		const prov = await db
			.select({ apiKey: providers.apiKey })
			.from(providers)
			.where(eq(providers.id, providerId))
			.limit(1);
		const fallback = prov[0]?.apiKey ? String(prov[0].apiKey).trim() : "";
		return fallback || null;
	} catch {
		return null;
	}
}

/** Refresh rates for every active amanai-compat provider. Never throws. */
export async function refreshAmanaiRatesOnce(): Promise<{
	providers: number;
	updated: number;
	errors: string[];
}> {
	const errors: string[] = [];
	let providersSeen = 0;
	let updated = 0;

	try {
		const rows = await db.select().from(providers).where(eq(providers.isActive, true));
		for (const p of rows) {
			if (!providerIsAmanaiCompat(p)) continue;
			providersSeen += 1;
			const key = await resolveProviderKey(p.id);
			if (!key) {
				errors.push(`${p.name}: no api key`);
				continue;
			}
			const res = await refreshAmanaiLiveRates({
				endpoint: String(p.endpoint || ""),
				apiKey: key,
			});
			if (res.error) errors.push(`${p.name}: ${res.error}`);
			updated = Math.max(updated, res.updated);
		}
	} catch (err: any) {
		errors.push(err?.message || String(err));
	}

	if (updated > 0) {
		const meta = getLiveRatesMeta();
		console.log(
			`[amanai-rates] refreshed ${meta.count} models from ${meta.endpoint}`,
		);
	} else if (errors.length > 0) {
		console.warn(`[amanai-rates] refresh skipped: ${errors.join("; ")}`);
	}

	return { providers: providersSeen, updated, errors };
}

export function initializeAmanaiRateScheduler(): void {
	if (started) return;
	started = true;

	const boot = setTimeout(() => {
		void refreshAmanaiRatesOnce().catch(() => {});
	}, BOOT_DELAY_MS);
	boot.unref?.();

	const timer = setInterval(() => {
		void refreshAmanaiRatesOnce().catch(() => {});
	}, REFRESH_INTERVAL_MS);
	timer.unref?.();
}
