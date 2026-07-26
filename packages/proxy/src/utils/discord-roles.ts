/**
 * Discord role hierarchy for account tier + limit mode.
 *
 * Staff (moderator / troubleshooter / contributor) sits ABOVE Phantom/Pro/Premium
 * for limits → always follow_global when any staff role is present.
 *
 * Without staff:
 *   Phantom → follow_global
 *   Pro (incl. Premium+Pro) → zero_unless_addon
 *   Premium-only → zero_unless_addon
 */

export type RoleLimitMode = "follow_global" | "zero_unless_addon";

export type PrimaryTier = "phantom" | "pro" | "premium" | "staff" | "none";

export type StaffBadge = "moderator" | "troubleshooter" | "contributor";

export interface RoleIdConfig {
	phantomRoleId?: string | null;
	premiumRoleId?: string | null;
	proRoleId?: string | null;
	contributorRoleId?: string | null;
	troubleshooterRoleId?: string | null;
	moderatorRoleId?: string | null;
	/** Per-role override of default limit modes (JSON from admin_config). */
	roleLimitModes?: Partial<Record<"phantom" | "premium" | "pro" | "contributor" | "troubleshooter" | "moderator", RoleLimitMode>> | null;
}

export interface ResolvedDiscordRoles {
	primary: PrimaryTier;
	staff: StaffBadge[];
	badges: string[];
	limitMode: RoleLimitMode;
	hasPhantom: boolean;
	hasPremium: boolean;
	hasPro: boolean;
	hasStaff: boolean;
}

const DEFAULT_ROLE_IDS = {
	phantom: "1354646304042651728",
	premium: "1354682641961582632",
	pro: "1354682701453725857",
	contributor: "1354642624895778866",
	troubleshooter: "1354683007427936366",
	moderator: "1354683043478110309",
};

function id(v: string | null | undefined, fallback: string): string {
	const s = String(v || "").trim();
	return s || fallback;
}

function defaultModeFor(tier: PrimaryTier, cfg: RoleIdConfig): RoleLimitMode {
	const modes = cfg.roleLimitModes || {};
	if (tier === "staff") {
		return modes.moderator || modes.troubleshooter || modes.contributor || "follow_global";
	}
	if (tier === "phantom") return modes.phantom || "follow_global";
	if (tier === "pro") return modes.pro || "zero_unless_addon";
	if (tier === "premium") return modes.premium || "zero_unless_addon";
	return "follow_global";
}

export function resolveDiscordRoles(
	memberRoleIds: string[],
	cfg: RoleIdConfig = {},
): ResolvedDiscordRoles {
	const set = new Set(memberRoleIds.map((r) => String(r).trim()).filter(Boolean));
	const phantomId = id(cfg.phantomRoleId, DEFAULT_ROLE_IDS.phantom);
	const premiumId = id(cfg.premiumRoleId, DEFAULT_ROLE_IDS.premium);
	const proId = id(cfg.proRoleId, DEFAULT_ROLE_IDS.pro);
	const contributorId = id(cfg.contributorRoleId, DEFAULT_ROLE_IDS.contributor);
	const troubleshooterId = id(cfg.troubleshooterRoleId, DEFAULT_ROLE_IDS.troubleshooter);
	const moderatorId = id(cfg.moderatorRoleId, DEFAULT_ROLE_IDS.moderator);

	const hasPhantom = set.has(phantomId);
	const hasPremium = set.has(premiumId);
	const hasPro = set.has(proId);
	const staff: StaffBadge[] = [];
	if (set.has(moderatorId)) staff.push("moderator");
	if (set.has(troubleshooterId)) staff.push("troubleshooter");
	if (set.has(contributorId)) staff.push("contributor");
	const hasStaff = staff.length > 0;

	let primary: PrimaryTier = "none";
	if (hasStaff) {
		primary = "staff";
	} else if (hasPhantom) {
		primary = "phantom";
	} else if (hasPro) {
		primary = "pro";
	} else if (hasPremium) {
		primary = "premium";
	}

	const badges: string[] = [];
	if (hasStaff) {
		// Staff primary for limits; still show Phantom/Pro/Premium as secondary badges if held
		if (hasPhantom) badges.push("phantom");
		else if (hasPro) badges.push("pro");
		else if (hasPremium) badges.push("premium");
		for (const s of staff) badges.push(s);
	} else {
		if (primary !== "none") badges.push(primary);
	}

	const limitMode = hasStaff
		? "follow_global"
		: defaultModeFor(primary === "none" ? "phantom" : primary, cfg);

	return {
		primary,
		staff,
		badges,
		limitMode: hasStaff ? (cfg.roleLimitModes?.moderator || "follow_global") : limitMode,
		hasPhantom,
		hasPremium,
		hasPro,
		hasStaff,
	};
}

export type DiscordMemberRolesResult =
	| {
			status: "found";
			guildId: string;
			roleIds: string[];
			username?: string;
	  }
	/** Confirmed: member 404 in every guild the bot can see. */
	| { status: "not_found" }
	/** Rate-limit / network / API error — do NOT treat as “no roles”. */
	| { status: "error"; detail?: string };

/**
 * Fetch a guild member's role IDs via Discord REST (bot token).
 * Unions roles across all mutual guilds (bot may be in multiple Groupy servers).
 */
export async function fetchDiscordMemberRoleIds(
	botToken: string,
	discordUserId: string,
): Promise<DiscordMemberRolesResult> {
	const token = String(botToken || "").trim();
	if (!token || !/^\d{15,25}$/.test(discordUserId)) {
		return { status: "error", detail: "invalid token or discordUserId" };
	}

	const headers = {
		Authorization: `Bot ${token}`,
		"Content-Type": "application/json",
	};

	const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers });
	if (!guildsRes.ok) {
		console.warn("[discord-roles] guilds fetch failed:", guildsRes.status);
		return { status: "error", detail: `guilds ${guildsRes.status}` };
	}
	const guilds = (await guildsRes.json()) as Array<{ id: string }>;
	if (!Array.isArray(guilds) || guilds.length === 0) {
		return { status: "error", detail: "no guilds" };
	}

	const roleIds = new Set<string>();
	let primaryGuildId = "";
	let username: string | undefined;
	let foundAny = false;
	let hadTransientError = false;

	for (const g of guilds) {
		const memRes = await fetch(
			`https://discord.com/api/v10/guilds/${g.id}/members/${discordUserId}`,
			{ headers },
		);
		if (memRes.status === 404) continue;
		if (memRes.status === 429 || memRes.status >= 500 || !memRes.ok) {
			hadTransientError = true;
			console.warn(`[discord-roles] member fetch ${g.id}/${discordUserId}:`, memRes.status);
			continue;
		}
		const mem = (await memRes.json()) as {
			roles?: string[];
			user?: { username?: string; global_name?: string };
		};
		foundAny = true;
		if (!primaryGuildId) primaryGuildId = g.id;
		if (!username) username = mem.user?.global_name || mem.user?.username;
		for (const r of Array.isArray(mem.roles) ? mem.roles : []) {
			const id = String(r || "").trim();
			if (id) roleIds.add(id);
		}
	}

	if (foundAny) {
		return {
			status: "found",
			guildId: primaryGuildId,
			roleIds: [...roleIds],
			username,
		};
	}
	if (hadTransientError) {
		return { status: "error", detail: "member fetch transient failure" };
	}
	return { status: "not_found" };
}

export function parseRoleLimitModes(raw: unknown): RoleIdConfig["roleLimitModes"] {
	if (!raw) return {};
	try {
		const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (!obj || typeof obj !== "object") return {};
		const out: NonNullable<RoleIdConfig["roleLimitModes"]> = {};
		for (const k of ["phantom", "premium", "pro", "contributor", "troubleshooter", "moderator"] as const) {
			const v = (obj as any)[k];
			if (v === "follow_global" || v === "zero_unless_addon") out[k] = v;
		}
		return out;
	} catch {
		return {};
	}
}

export { DEFAULT_ROLE_IDS };
