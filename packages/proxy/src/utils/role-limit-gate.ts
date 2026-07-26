/**
 * Premium/Pro (zero_unless_addon): no shared quota and no dedicated pools
 * unless the user has an active add-on.
 */

export function isZeroUnlessAddonMode(key: {
	roleLimitMode?: string | null;
	provisionedBy?: string | null;
}): boolean {
	return String(key.roleLimitMode || "").trim() === "zero_unless_addon";
}

/** True when this key must be blocked from all token usage (no add-on). */
export function isBlockedWithoutAddon(
	key: { roleLimitMode?: string | null },
	activeAddonCount: number,
): boolean {
	return isZeroUnlessAddonMode(key) && activeAddonCount <= 0;
}
