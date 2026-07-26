/** Portal account badges: Premium / Pro / Phantom / Staff (+ Add-on). No Admin Override. */

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

/** Display order: staff first, then membership tiers, then add-on, trial last */
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

const HIDDEN = new Set(["admin_override", "none", ""]);

export function badgeLabel(key: string): string {
	return LABEL[key] || key;
}

export function badgeClass(key: string): string {
	switch (key) {
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

export function resolveDisplayBadges(
	accountType?: string | null,
	accountBadges?: string[] | null,
	opts?: { hasAddon?: boolean },
): string[] {
	const raw = Array.isArray(accountBadges) ? [...accountBadges] : [];
	if (accountType && !raw.includes(accountType)) raw.unshift(accountType);
	if (opts?.hasAddon && !raw.includes("addon")) raw.push("addon");

	let uniq = [
		...new Set(
			raw
				.map((b) => String(b).trim())
				.filter((b) => b && !HIDDEN.has(b)),
		),
	];

	// Collapse staff role variants into one Staff badge
	const hasStaffRole = uniq.some((b) =>
		["staff", "moderator", "troubleshooter", "contributor"].includes(b),
	);
	if (hasStaffRole) {
		uniq = uniq.filter(
			(b) => !["moderator", "troubleshooter", "contributor"].includes(b),
		);
		if (!uniq.includes("staff")) uniq.push("staff");
	}

	const paid = uniq.some((b) =>
		["phantom", "pro", "premium", "staff", "addon"].includes(b),
	);
	if (paid) uniq = uniq.filter((b) => b !== "trial");

	uniq.sort((a, b) => {
		const ia = ORDER.indexOf(a);
		const ib = ORDER.indexOf(b);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
	});
	return uniq.slice(0, 5);
}
