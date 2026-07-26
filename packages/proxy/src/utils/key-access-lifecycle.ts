/**
 * API key stay-active policy for Discord-linked non-trial keys:
 *   keep active while Phantom OR Staff OR active add-on
 *   Pro / Premium alone do NOT keep the key alive
 *   when add-on expires and no Phantom/Staff → disable
 *   when add-on assigned/extended on a disabled key → re-enable
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { adminConfig, apiKeys } from "../db/schema.js";
import { getActiveAddonsForUser } from "./addons.js";
import {
	fetchDiscordMemberRoleIds,
	parseRoleLimitModes,
	resolveDiscordRoles,
} from "./discord-roles.js";
import { queueUserNotification } from "./user-notify.js";

export type KeyAccessSyncResult = {
	discordUserId: string;
	shouldKeep: boolean;
	hasPhantom: boolean;
	hasStaff: boolean;
	hasActiveAddon: boolean;
	action: "enabled" | "disabled" | "unchanged" | "skipped";
	keyIds: number[];
	reason: string;
};

function shouldKeepKeyAccess(opts: {
	hasPhantom: boolean;
	hasStaff: boolean;
	hasActiveAddon: boolean;
}): boolean {
	return !!(opts.hasPhantom || opts.hasStaff || opts.hasActiveAddon);
}

async function resolveRolesForUser(
	discordUserId: string,
	hintRoleIds?: string[] | null,
): Promise<{ hasPhantom: boolean; hasStaff: boolean; roleIds: string[] }> {
	if (Array.isArray(hintRoleIds)) {
		const cfg = (await db.select().from(adminConfig).limit(1))[0] ?? null;
		const resolved = resolveDiscordRoles(hintRoleIds, {
			phantomRoleId: cfg?.requiredRoleId,
			premiumRoleId: (cfg as any)?.premiumRoleId || cfg?.trialRequiredRoleId,
			proRoleId: cfg?.proRoleId,
			contributorRoleId: cfg?.contributorRoleId,
			troubleshooterRoleId: cfg?.troubleshooterRoleId,
			moderatorRoleId: cfg?.moderatorRoleId,
			roleLimitModes: parseRoleLimitModes((cfg as any)?.roleLimitModes),
		});
		return {
			hasPhantom: resolved.hasPhantom,
			hasStaff: resolved.hasStaff,
			roleIds: hintRoleIds,
		};
	}

	const cfg = (await db.select().from(adminConfig).limit(1))[0] ?? null;
	const botToken =
		process.env.DISCORD_BOT_TOKEN ||
		process.env.BOT_TOKEN ||
		String(cfg?.discordBotToken || "").trim();
	if (botToken) {
		const mem = await fetchDiscordMemberRoleIds(botToken, discordUserId);
		if (mem) {
			const resolved = resolveDiscordRoles(mem.roleIds, {
				phantomRoleId: cfg?.requiredRoleId,
				premiumRoleId: (cfg as any)?.premiumRoleId || cfg?.trialRequiredRoleId,
				proRoleId: cfg?.proRoleId,
				contributorRoleId: cfg?.contributorRoleId,
				troubleshooterRoleId: cfg?.troubleshooterRoleId,
				moderatorRoleId: cfg?.moderatorRoleId,
				roleLimitModes: parseRoleLimitModes((cfg as any)?.roleLimitModes),
			});
			return {
				hasPhantom: resolved.hasPhantom,
				hasStaff: resolved.hasStaff,
				roleIds: mem.roleIds,
			};
		}
	}

	return { hasPhantom: false, hasStaff: false, roleIds: [] };
}

/**
 * Sync isActive + accountBadges / accountTier / roleLimitMode for all non-trial
 * keys linked to this Discord user.
 */
export async function syncUserKeyAccess(
	discordUserId: string,
	opts?: {
		roleIds?: string[] | null;
		reason?: string;
		/** Skip Discord fetch; use only hint + addons (empty roles if no hint). */
		rolesKnown?: boolean;
	},
): Promise<KeyAccessSyncResult> {
	const uid = String(discordUserId || "").trim();
	if (!/^\d{15,25}$/.test(uid)) {
		return {
			discordUserId: uid,
			shouldKeep: false,
			hasPhantom: false,
			hasStaff: false,
			hasActiveAddon: false,
			action: "skipped",
			keyIds: [],
			reason: "invalid discordUserId",
		};
	}

	const keys = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.discordUserId, uid), eq(apiKeys.isTrial, false)));

	if (keys.length === 0) {
		return {
			discordUserId: uid,
			shouldKeep: false,
			hasPhantom: false,
			hasStaff: false,
			hasActiveAddon: false,
			action: "skipped",
			keyIds: [],
			reason: "no non-trial keys",
		};
	}

	const activeAddons = await getActiveAddonsForUser({ discordUserId: uid });
	const hasActiveAddon = activeAddons.length > 0;

	const cfg = (await db.select().from(adminConfig).limit(1))[0] ?? null;
	const roleCfg = {
		phantomRoleId: cfg?.requiredRoleId,
		premiumRoleId: (cfg as any)?.premiumRoleId || cfg?.trialRequiredRoleId,
		proRoleId: cfg?.proRoleId,
		contributorRoleId: cfg?.contributorRoleId,
		troubleshooterRoleId: cfg?.troubleshooterRoleId,
		moderatorRoleId: cfg?.moderatorRoleId,
		roleLimitModes: parseRoleLimitModes((cfg as any)?.roleLimitModes),
	};

	let roleIds: string[] = [];
	let hasPhantom = false;
	let hasStaff = false;
	let resolved = resolveDiscordRoles([], roleCfg);

	if (opts?.rolesKnown && Array.isArray(opts.roleIds)) {
		roleIds = opts.roleIds;
		resolved = resolveDiscordRoles(roleIds, roleCfg);
		hasPhantom = resolved.hasPhantom;
		hasStaff = resolved.hasStaff;
	} else if (opts?.rolesKnown && opts.roleIds === null) {
		hasPhantom = false;
		hasStaff = false;
		resolved = resolveDiscordRoles([], roleCfg);
	} else {
		const r = await resolveRolesForUser(uid, opts?.roleIds);
		roleIds = r.roleIds;
		resolved = resolveDiscordRoles(roleIds, roleCfg);
		hasPhantom = resolved.hasPhantom;
		hasStaff = resolved.hasStaff;
	}

	const accountTier =
		resolved.primary === "none"
			? hasActiveAddon
				? "premium"
				: ""
			: resolved.primary === "staff"
				? "staff"
				: resolved.primary;
	const badges = resolved.badges.filter(
		(b) => b && b !== "none" && b !== "admin_override",
	);
	const limitMode = resolved.limitMode;
	const badgesJson = JSON.stringify(badges);

	// Always refresh tier/badges/limit mode from live Discord roles
	await db
		.update(apiKeys)
		.set({
			accountBadges: badgesJson,
			accountTier: accountTier || "",
			roleLimitMode: limitMode,
			updatedAt: new Date(),
		})
		.where(and(eq(apiKeys.discordUserId, uid), eq(apiKeys.isTrial, false)));

	const shouldKeep = shouldKeepKeyAccess({ hasPhantom, hasStaff, hasActiveAddon });
	const reason =
		opts?.reason ||
		(shouldKeep
			? hasActiveAddon && !hasPhantom && !hasStaff
				? "active add-on"
				: hasPhantom
					? "Phantom role"
					: hasStaff
						? "Staff role"
						: "access retained"
			: "no Phantom/Staff and no active add-on");

	const keyIds = keys.map((k) => k.id);
	const anyActive = keys.some((k) => k.isActive);
	const anyInactive = keys.some((k) => !k.isActive);

	if (shouldKeep && anyInactive) {
		await db
			.update(apiKeys)
			.set({ isActive: true, updatedAt: new Date() })
			.where(and(eq(apiKeys.discordUserId, uid), eq(apiKeys.isTrial, false)));

		const primary = keys.find((k) => !k.isActive) || keys[0];
		await queueUserNotification(primary.id, {
			type: "key_enabled",
			title: "✅ API Key Aktif Lagi",
			message:
				`API key Anda diaktifkan kembali karena: **${reason}**.\n` +
				(hasActiveAddon
					? `Add-on aktif: ${activeAddons.map((a) => a.name).join(", ")}.`
					: ""),
		});

		return {
			discordUserId: uid,
			shouldKeep,
			hasPhantom,
			hasStaff,
			hasActiveAddon,
			action: "enabled",
			keyIds,
			reason,
		};
	}

	if (!shouldKeep && anyActive) {
		await db
			.update(apiKeys)
			.set({ isActive: false, updatedAt: new Date() })
			.where(and(eq(apiKeys.discordUserId, uid), eq(apiKeys.isTrial, false)));

		const primary = keys.find((k) => k.isActive) || keys[0];
		await queueUserNotification(primary.id, {
			type: "key_disabled",
			title: "API Key Dinonaktifkan",
			message:
				"API key Anda dinonaktifkan karena tidak ada role Phantom/Staff dan tidak ada add-on aktif.\n\n" +
				"Pro/Premium saja tidak cukup untuk menjaga key tetap aktif.\n" +
				"Key akan aktif lagi otomatis jika Phantom kembali atau add-on diperpanjang/diaktifkan.",
		});

		return {
			discordUserId: uid,
			shouldKeep,
			hasPhantom,
			hasStaff,
			hasActiveAddon,
			action: "disabled",
			keyIds,
			reason,
		};
	}

	return {
		discordUserId: uid,
		shouldKeep,
		hasPhantom,
		hasStaff,
		hasActiveAddon,
		action: "unchanged",
		keyIds,
		reason,
	};
}

/** After add-on assign / extend / expire — re-evaluate key + rely on role sync separately. */
export async function syncUserKeyAccessAfterAddonChange(
	discordUserId: string | null | undefined,
	reason?: string,
): Promise<KeyAccessSyncResult | null> {
	const uid = String(discordUserId || "").trim();
	if (!uid) return null;
	return syncUserKeyAccess(uid, { reason: reason || "add-on change" });
}
