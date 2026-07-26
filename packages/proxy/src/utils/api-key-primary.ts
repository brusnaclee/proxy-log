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
	provisionedBy?: string | null;
};

/**
 * Portal may show multiple Primary badges:
 * - trial key (dedicated trial), if any
 * - main membership key: admin-override, else first discord-bot (Phantom), else oldest non-trial
 */
export function getPortalPrimaryKeyIds(keys: KeyRow[]): number[] {
	const ids: number[] = [];
	const trial = keys.find((k) => k.isTrial);
	if (trial) ids.push(trial.id);

	const override = keys.find(
		(k) =>
			!k.isTrial &&
			String(k.provisionedBy || "").trim().toLowerCase() === "admin-override",
	);
	const phantomFirst = keys
		.filter(
			(k) =>
				!k.isTrial &&
				String(k.provisionedBy || "").trim().toLowerCase() === "discord-bot",
		)
		.sort((a, b) => Number(a.id) - Number(b.id))[0];
	const oldestNonTrial = [...keys]
		.filter((k) => !k.isTrial)
		.sort((a, b) => Number(a.id) - Number(b.id))[0];
	const main = override || phantomFirst || oldestNonTrial;
	if (main && !ids.includes(main.id)) ids.push(main.id);
	return ids;
}
