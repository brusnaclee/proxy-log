/** Portal/admin account badges: Premium / Pro / Phantom / Staff (+ Add-on). No Admin Override. */

export type BadgeKey =
	| "trial"
	| "phantom"
	| "pro"
	| "premium"
	| "staff"
	| "addon"
	| "moderator"
	| "troubleshooter"
	| "contributor"
	| string;

const LABEL: Record<string, string> = {
	trial: "Trial",
	phantom: "Phantom",
	pro: "Pro",
	premium: "Premium",
	staff: "Staff",
	addon: "Add-on",
	moderator: "Moderator",
	troubleshooter: "Troubleshooter",
	contributor: "Contributor",
};

const ORDER = [
	"staff",
	"moderator",
	"troubleshooter",
	"contributor",
	"phantom",
	"pro",
	"premium",
	"addon",
	"trial",
];

const HIDDEN = new Set([
	"admin_override",
	"admin-override",
	"adminoverride",
	"none",
	"",
]);

/** Normalize badge tokens so "Admin Override" / admin_override / ADMIN-OVERRIDE all match. */
export function normalizeBadgeKey(raw: string): string {
	return String(raw || "")
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
}

export function badgeLabel(key: string): string {
	const n = normalizeBadgeKey(key);
	return LABEL[n] || LABEL[key] || key;
}

export function badgeClass(key: string): string {
	const n = normalizeBadgeKey(key);
	switch (n) {
		case "moderator":
		case "troubleshooter":
		case "contributor":
		case "staff":
			return "bg-violet-400/15 text-violet-300 border border-violet-400/30";
		case "pro":
			return "bg-emerald-400/15 text-emerald-300 border border-emerald-400/30";
		case "premium":
			return "bg-amber-400/15 text-amber-300 border border-amber-400/30";
		case "phantom":
			return "bg-primary/15 text-primary border border-primary/30";
		case "addon":
			return "bg-cyan-400/15 text-cyan-300 border border-cyan-400/30";
		case "trial":
			return "bg-yellow-400/15 text-yellow-400 border border-yellow-400/30";
		default:
			return "bg-muted text-muted-foreground border border-border";
	}
}

export type AddonExpiry = { name?: string; expiresAt?: string | null };

/** Format add-on expiry for badges, e.g. "26 Agu 2026" or "no expiry". */
export function formatAddonExpiry(
	expiresAt?: string | null,
	locale: string = "id-ID",
): string {
	if (!expiresAt) return "no expiry";
	const d = new Date(expiresAt);
	if (Number.isNaN(d.getTime())) return "no expiry";
	return d.toLocaleDateString(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/**
 * Resolve display badges. Always hides Admin Override variants.
 * Pass hasAddon / addons to force Add-on chip (expiry shown separately in UI).
 */
export function resolveDisplayBadges(
	accountType?: string | null,
	accountBadges?: string[] | null,
	opts?: { hasAddon?: boolean; addons?: AddonExpiry[] },
): string[] {
	const raw = Array.isArray(accountBadges) ? [...accountBadges] : [];
	if (accountType) {
		const t = normalizeBadgeKey(accountType);
		if (!HIDDEN.has(t) && !raw.some((b) => normalizeBadgeKey(b) === t)) {
			raw.unshift(accountType);
		}
	}
	const hasAddon =
		opts?.hasAddon ||
		(Array.isArray(opts?.addons) && opts!.addons!.length > 0);
	if (hasAddon && !raw.some((b) => normalizeBadgeKey(b) === "addon")) {
		raw.push("addon");
	}

	let uniq = [
		...new Set(
			raw
				.map((b) => normalizeBadgeKey(b))
				.filter((b) => b && !HIDDEN.has(b)),
		),
	];

	// Prefer specific staff roles (Moderator / Troubleshooter / Contributor)
	// over a generic "Staff" chip when Discord already gave the subtype.
	const hasSpecificStaff = uniq.some((b) =>
		["moderator", "troubleshooter", "contributor"].includes(b),
	);
	if (hasSpecificStaff) {
		uniq = uniq.filter((b) => b !== "staff");
	}

	const paid = uniq.some((b) =>
		[
			"phantom",
			"pro",
			"premium",
			"staff",
			"addon",
			"moderator",
			"troubleshooter",
			"contributor",
		].includes(b),
	);
	if (paid) uniq = uniq.filter((b) => b !== "trial");

	uniq.sort((a, b) => {
		const ia = ORDER.indexOf(a);
		const ib = ORDER.indexOf(b);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
	});
	return uniq.slice(0, 6);
}
