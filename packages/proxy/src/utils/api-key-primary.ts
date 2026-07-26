/**
 * Primary Discord / trial / override keys cannot be deleted from the portal —
 * only extra keys the user created themselves (provisionedBy=portal|dashboard).
 */
export function isProtectedPrimaryApiKey(key: {
	provisionedBy?: string | null;
	isTrial?: boolean | null;
}): boolean {
	const by = String(key.provisionedBy || "").trim().toLowerCase();
	return (
		by === "discord-bot" ||
		by === "trial-bot" ||
		by === "admin-override"
	);
}

/** User-created keys only (portal “Buat Kunci” / dashboard extras). */
export function canUserDeleteApiKey(key: {
	provisionedBy?: string | null;
}): boolean {
	const by = String(key.provisionedBy || "").trim().toLowerCase();
	return by === "portal" || by === "dashboard";
}

/** Admin UI may still delete admin-override; block only Discord-claim / trial keys. */
export function isAdminDeleteBlocked(key: {
	provisionedBy?: string | null;
}): boolean {
	const by = String(key.provisionedBy || "").trim().toLowerCase();
	return by === "discord-bot" || by === "trial-bot";
}

type KeyRow = {
	id: number;
	isTrial?: boolean | null;
	isActive?: boolean | null;
	provisionedBy?: string | null;
};

/**
 * Main membership key (non-trial): admin-override, else oldest discord-bot, else oldest non-trial.
 * Prefer active keys when `preferActive` (default true).
 */
export function pickPrimaryNonTrialKey<T extends KeyRow>(
	keys: T[],
	opts?: { preferActive?: boolean },
): T | null {
	const preferActive = opts?.preferActive !== false;
	const nonTrial = keys.filter((k) => !k.isTrial);
	if (!nonTrial.length) return null;

	const pool = preferActive
		? nonTrial.filter((k) => k.isActive !== false)
		: nonTrial;
	const candidates = pool.length ? pool : nonTrial;

	const override = candidates.find(
		(k) => String(k.provisionedBy || "").trim().toLowerCase() === "admin-override",
	);
	if (override) return override;

	const phantomFirst = candidates
		.filter(
			(k) => String(k.provisionedBy || "").trim().toLowerCase() === "discord-bot",
		)
		.sort((a, b) => Number(a.id) - Number(b.id))[0];
	if (phantomFirst) return phantomFirst;

	return [...candidates].sort((a, b) => Number(a.id) - Number(b.id))[0] ?? null;
}

/**
 * Portal may show multiple Primary badges:
 * - trial key (dedicated trial), if any
 * - main membership key: admin-override, else first discord-bot (Phantom), else oldest non-trial
 */
export function getPortalPrimaryKeyIds(keys: KeyRow[]): number[] {
	const ids: number[] = [];
	const trial = keys.find((k) => k.isTrial);
	if (trial) ids.push(trial.id);

	const main = pickPrimaryNonTrialKey(keys, { preferActive: false });
	if (main && !ids.includes(main.id)) ids.push(main.id);
	return ids;
}

/** Stable sort: Primary (membership) first, then trial, then by id ascending. */
export function sortKeysPrimaryFirst<T extends KeyRow>(keys: T[]): T[] {
	const primaryIds = new Set(getPortalPrimaryKeyIds(keys));
	return [...keys].sort((a, b) => {
		const ap = primaryIds.has(a.id) ? 0 : 1;
		const bp = primaryIds.has(b.id) ? 0 : 1;
		if (ap !== bp) return ap - bp;
		return Number(a.id) - Number(b.id);
	});
}
