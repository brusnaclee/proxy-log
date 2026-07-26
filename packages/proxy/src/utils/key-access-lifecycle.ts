/**
 * API key stay-active policy for Discord-linked non-trial keys:
 *   keep active while Phantom OR Staff OR active add-on
 *   Pro / Premium alone do NOT keep the key alive
 *   when add-on expires and no Phantom/Staff → disable
 *   when add-on assigned/extended on a disabled key → re-enable
 *
 * CRITICAL: never disable when Discord role lookup is unconfirmed
 * (rate-limit / network / partial failure). That caused mass false
 * disables on deploy restart + bulk sync.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { adminConfig, apiKeys } from "../db/schema.js";
import { getActiveAddonsForUser } from "./addons.js";
import {
	fetchDiscordMemberRoleIds,
	parseRoleLimitModes,
	resolveDiscordRoles,
	type ResolvedDiscordRoles,
} from "./discord-roles.js";
import { queueUserNotification } from "./user-notify.js";

export type KeyAccessSyncResult = {
	discordUserId: string;
	shouldKeep: boolean;
	hasPhantom: boolean;
	hasStaff: boolean;
	hasActiveAddon: boolean;
	rolesConfirmed: boolean;
	action: "enabled" | "disabled" | "unchanged" | "skipped";
	keyIds: number[];
	reason: string;
};

export function shouldKeepKeyAccess(opts: {
	hasPhantom: boolean;
	hasStaff: boolean;
	hasActiveAddon: boolean;
}): boolean {
	return !!(opts.hasPhantom || opts.hasStaff || opts.hasActiveAddon);
}

/** Only disable when Discord membership/roles are confirmed empty of keep-roles. */
export function canDisableKeyAccess(opts: {
	rolesConfirmed: boolean;
	shouldKeep: boolean;
}): boolean {
	return opts.rolesConfirmed && !opts.shouldKeep;
}

type ResolvedAccessRoles = {
	roleIds: string[];
	hasPhantom: boolean;
	hasStaff: boolean;
	resolved: ResolvedDiscordRoles;
	/** true = safe to disable if shouldKeep is false */
	rolesConfirmed: boolean;
};

function roleCfgFromAdmin(cfg: typeof adminConfig.$inferSelect | null) {
	return {
		phantomRoleId: cfg?.requiredRoleId,
		premiumRoleId: (cfg as any)?.premiumRoleId || cfg?.trialRequiredRoleId,
		proRoleId: cfg?.proRoleId,
		contributorRoleId: cfg?.contributorRoleId,
		troubleshooterRoleId: cfg?.troubleshooterRoleId,
		moderatorRoleId: cfg?.moderatorRoleId,
		roleLimitModes: parseRoleLimitModes((cfg as any)?.roleLimitModes),
	};
}

async function resolveRolesForUser(
	discordUserId: string,
	hintRoleIds?: string[] | null,
	rolesKnown?: boolean,
): Promise<ResolvedAccessRoles> {
	const cfg = (await db.select().from(adminConfig).limit(1))[0] ?? null;
	const roleCfg = roleCfgFromAdmin(cfg);
	const empty = resolveDiscordRoles([], roleCfg);

	// Bot / caller already knows membership (incl. left-guild → roleIds null)
	if (rolesKnown) {
		if (hintRoleIds === null) {
			return {
				roleIds: [],
				hasPhantom: false,
				hasStaff: false,
				resolved: empty,
				rolesConfirmed: true,
			};
		}
		if (Array.isArray(hintRoleIds)) {
			const resolved = resolveDiscordRoles(hintRoleIds, roleCfg);
			return {
				roleIds: hintRoleIds,
				hasPhantom: resolved.hasPhantom,
				hasStaff: resolved.hasStaff,
				resolved,
				rolesConfirmed: true,
			};
		}
	}

	if (Array.isArray(hintRoleIds)) {
		const resolved = resolveDiscordRoles(hintRoleIds, roleCfg);
		return {
			roleIds: hintRoleIds,
			hasPhantom: resolved.hasPhantom,
			hasStaff: resolved.hasStaff,
			resolved,
			rolesConfirmed: true,
		};
	}

	const botToken =
		process.env.DISCORD_BOT_TOKEN ||
		process.env.BOT_TOKEN ||
		String(cfg?.discordBotToken || "").trim();
	if (!botToken) {
		return {
			roleIds: [],
			hasPhantom: false,
			hasStaff: false,
			resolved: empty,
			rolesConfirmed: false,
		};
	}

	const mem = await fetchDiscordMemberRoleIds(botToken, discordUserId);
	if (mem.status === "found") {
		const resolved = resolveDiscordRoles(mem.roleIds, roleCfg);
		return {
			roleIds: mem.roleIds,
			hasPhantom: resolved.hasPhantom,
			hasStaff: resolved.hasStaff,
			resolved,
			rolesConfirmed: true,
		};
	}
	if (mem.status === "not_found") {
		// Left every mutual guild — confirmed no Discord keep-roles
		return {
			roleIds: [],
			hasPhantom: false,
			hasStaff: false,
			resolved: empty,
			rolesConfirmed: true,
		};
	}

	// error / rate-limit — do not treat as no roles
	console.warn(
		`[key-access] Discord roles unconfirmed for ${discordUserId}: ${mem.detail || "error"}`,
	);
	return {
		roleIds: [],
		hasPhantom: false,
		hasStaff: false,
		resolved: empty,
		rolesConfirmed: false,
	};
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
		/** If true, never disable (badge refresh / safe bulk). */
		allowDisable?: boolean;
	},
): Promise<KeyAccessSyncResult> {
	const uid = String(discordUserId || "").trim();
	const allowDisable = opts?.allowDisable !== false;

	if (!/^\d{15,25}$/.test(uid)) {
		return {
			discordUserId: uid,
			shouldKeep: false,
			hasPhantom: false,
			hasStaff: false,
			hasActiveAddon: false,
			rolesConfirmed: false,
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
			rolesConfirmed: false,
			action: "skipped",
			keyIds: [],
			reason: "no non-trial keys",
		};
	}

	const activeAddons = await getActiveAddonsForUser({ discordUserId: uid });
	const hasActiveAddon = activeAddons.length > 0;

	const r = await resolveRolesForUser(uid, opts?.roleIds, opts?.rolesKnown);
	const { hasPhantom, hasStaff, rolesConfirmed, resolved } = r;

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
	if (hasActiveAddon && !badges.includes("addon")) badges.push("addon");
	const limitMode = resolved.limitMode;
	const badgesJson = JSON.stringify(badges);

	// Only rewrite badges/tier when Discord roles are confirmed — never wipe on fetch failure
	if (rolesConfirmed) {
		await db
			.update(apiKeys)
			.set({
				accountBadges: badgesJson,
				accountTier: accountTier || "",
				roleLimitMode: limitMode,
				updatedAt: new Date(),
			})
			.where(and(eq(apiKeys.discordUserId, uid), eq(apiKeys.isTrial, false)));
	} else if (hasActiveAddon) {
		// Still stamp addon badge without clobbering existing role badges
		for (const key of keys) {
			let existing: string[] = [];
			try {
				existing = JSON.parse((key as any).accountBadges || "[]");
				if (!Array.isArray(existing)) existing = [];
			} catch {
				existing = [];
			}
			if (!existing.includes("addon")) {
				await db
					.update(apiKeys)
					.set({
						accountBadges: JSON.stringify([...existing, "addon"]),
						updatedAt: new Date(),
					})
					.where(eq(apiKeys.id, key.id));
			}
		}
	}

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
			: rolesConfirmed
				? "no Phantom/Staff and no active add-on"
				: "discord roles unconfirmed");

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
			rolesConfirmed,
			action: "enabled",
			keyIds,
			reason,
		};
	}

	if (
		allowDisable &&
		canDisableKeyAccess({ rolesConfirmed, shouldKeep }) &&
		anyActive
	) {
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
			rolesConfirmed,
			action: "disabled",
			keyIds,
			reason,
		};
	}

	if (!rolesConfirmed && !shouldKeep && anyActive) {
		return {
			discordUserId: uid,
			shouldKeep,
			hasPhantom,
			hasStaff,
			hasActiveAddon,
			rolesConfirmed,
			action: "skipped",
			keyIds,
			reason: "discord roles unconfirmed — not disabling",
		};
	}

	return {
		discordUserId: uid,
		shouldKeep,
		hasPhantom,
		hasStaff,
		hasActiveAddon,
		rolesConfirmed,
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

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i]);
			// Soft pacing against Discord REST rate limits
			await new Promise((r) => setTimeout(r, 150));
		}
	});
	await Promise.all(workers);
	return results;
}

export type SyncAllDiscordKeyRolesResult = {
	total: number;
	synced: number;
	skipped: number;
	errors: number;
	enabled: number;
	disabled: number;
};

/**
 * Refresh Discord roles/badges for every distinct Discord user linked to a non-trial key.
 * Daily job only — never run aggressively on every process restart.
 */
export async function syncAllDiscordLinkedKeyRoles(opts?: {
	concurrency?: number;
	reason?: string;
	/** Default true. Set false for badge-only safe pass. */
	allowDisable?: boolean;
}): Promise<SyncAllDiscordKeyRolesResult> {
	const rows = await db.execute(sql`
		SELECT DISTINCT discord_user_id AS id
		FROM api_keys
		WHERE discord_user_id IS NOT NULL
		  AND discord_user_id ~ '^[0-9]{15,25}$'
		  AND COALESCE(is_trial, false) = false
	`);
	const ids = [
		...new Set(
			((rows.rows || []) as Array<{ id?: string }>)
				.map((r) => String(r.id || "").trim())
				.filter((id) => /^\d{15,25}$/.test(id)),
		),
	];

	const reason = opts?.reason || "bulk discord role sync";
	const concurrency = Math.max(1, Math.min(2, opts?.concurrency ?? 1));
	const allowDisable = opts?.allowDisable !== false;
	let synced = 0;
	let skipped = 0;
	let errors = 0;
	let enabled = 0;
	let disabled = 0;

	await mapWithConcurrency(ids, concurrency, async (uid) => {
		try {
			const result = await syncUserKeyAccess(uid, { reason, allowDisable });
			if (result.action === "skipped") skipped += 1;
			else {
				synced += 1;
				if (result.action === "enabled") enabled += 1;
				if (result.action === "disabled") disabled += 1;
			}
		} catch (err) {
			errors += 1;
			console.warn(
				`[key-access] bulk sync failed for ${uid}:`,
				(err as Error)?.message || err,
			);
		}
	});

	return {
		total: ids.length,
		synced,
		skipped,
		errors,
		enabled,
		disabled,
	};
}
