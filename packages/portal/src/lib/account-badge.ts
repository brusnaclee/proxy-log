/** Display helpers for portal account badges (override / roles / trial). */

export type BadgeKey =
	| "trial"
	| "phantom"
	| "pro"
	| "premium"
	| "staff"
	| "admin_override"
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
	admin_override: "Admin Override",
	moderator: "Moderator",
	troubleshooter: "Troubleshooter",
	contributor: "Contributor",
};

const ORDER = [
	"admin_override",
	"moderator",
	"troubleshooter",
	"contributor",
	"staff",
	"phantom",
	"pro",
	"premium",
	"trial",
];

export function badgeLabel(key: string): string {
	return LABEL[key] || key;
}

export function badgeClass(key: string): string {
	switch (key) {
		case "admin_override":
			return "bg-sky-400/15 text-sky-300 border border-sky-400/30";
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
		case "trial":
			return "bg-yellow-400/15 text-yellow-400 border border-yellow-400/30";
		default:
			return "bg-muted text-muted-foreground border border-border";
	}
}

export function resolveDisplayBadges(
	accountType?: string | null,
	accountBadges?: string[] | null,
): string[] {
	const raw = Array.isArray(accountBadges) ? [...accountBadges] : [];
	if (accountType && !raw.includes(accountType)) raw.unshift(accountType);
	const uniq = [...new Set(raw.map((b) => String(b).trim()).filter(Boolean))];
	uniq.sort((a, b) => {
		const ia = ORDER.indexOf(a);
		const ib = ORDER.indexOf(b);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
	});
	return uniq.slice(0, 4);
}
