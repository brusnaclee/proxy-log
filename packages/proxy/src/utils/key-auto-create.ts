import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { adminConfig, apiKeys } from "../db/schema.js";
import { generateApiKey, getKeyPrefix, sha256 } from "./crypto.js";
import {
	fetchDiscordMemberRoleIds,
	parseRoleLimitModes,
	resolveDiscordRoles,
} from "./discord-roles.js";
import { queueUserNotification, formatPhantomCredentialsMessage } from "./user-notify.js";
import { getProxyPublicEndpoint } from "./proxy-public-url.js";

/**
 * Ensures a Discord user has at least one active, non-trial API key.
 * If none exists, provisions one via the same "admin-override" path used by the
 * API Keys menu: resolve Discord roles, derive limit mode + badges, insert key,
 * queue the DM with credentials, and return the plaintext key + keyId.
 *
 * If the user already has an active key, returns it (no-op) — the plaintext key
 * is only known at creation time, so the existing key is returned without it.
 *
 * Returns null when discordUserId is empty or provisioning failed.
 */
export async function ensureApiKeyForDiscordUser(opts: {
	discordUserId: string;
	discordUsername?: string;
	note?: string;
}): Promise<{
	keyId: number;
	apiKey: string;
	alreadyExists: boolean;
	keyName: string;
	endpoint: string;
	discordUsername?: string;
} | null> {
	const discordUserId = String(opts.discordUserId || "").trim();
	if (!discordUserId) return null;

	const [config] = await db.select().from(adminConfig).limit(1);
	const endpoint = getProxyPublicEndpoint();

	const [existing] = await db
		.select()
		.from(apiKeys)
		.where(and(
			eq(apiKeys.discordUserId, discordUserId),
			eq(apiKeys.isActive, true),
			eq(apiKeys.isTrial, false),
		))
		.limit(1);

	if (existing) {
		return {
			keyId: existing.id,
			apiKey: "",
			alreadyExists: true,
			keyName: existing.name,
			endpoint,
			discordUsername: existing.discordUsername || opts.discordUsername,
		};
	}

	let limitMode: string = "zero_unless_addon";
	let accountTier: string = "";
	let badges: string[] = [];
	let discordUsername = opts.discordUsername;

	if (config?.discordBotToken) {
		const member = await fetchDiscordMemberRoleIds(config.discordBotToken, discordUserId);
		if (member.status === "found" && !discordUsername) {
			discordUsername = member.username || discordUsername;
		}
		if (member.status === "found") {
			const resolved = resolveDiscordRoles(member.roleIds, {
				phantomRoleId: config?.requiredRoleId,
				premiumRoleId: config?.trialRequiredRoleId,
				proRoleId: (config as any)?.proRoleId,
				contributorRoleId: (config as any)?.contributorRoleId,
				troubleshooterRoleId: (config as any)?.troubleshooterRoleId,
				moderatorRoleId: (config as any)?.moderatorRoleId,
				roleLimitModes: parseRoleLimitModes((config as any)?.roleLimitModes),
			});
			limitMode = resolved.limitMode;
			accountTier = resolved.primary;
			badges = resolved.badges.filter((b: string) => b && b !== "none" && b !== "admin_override");
		}
	}

	const key = generateApiKey();
	const safeUser = String(discordUsername || "user")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32) || "user";
	const keyName = `Override-${safeUser}-${discordUserId}`;

	const [result] = await db
		.insert(apiKeys)
		.values({
			name: keyName,
			key,
			keyPrefix: getKeyPrefix(key),
			keyHash: sha256(key),
			discordUserId,
			discordUsername,
			provisionedBy: "admin-override",
			isActive: true,
			isTrial: false,
			maxDevices: 99,
			devicePolicy: "none",
			ipPolicy: "none",
			idePolicy: "none",
			dailyTokenLimit: 0,
			monthlyTokenLimit: 0,
			dailyInputTokenLimit: 0,
			dailyOutputTokenLimit: 0,
			promptLimit: 0,
			promptLimitWindow: "5h",
			perMonthPromptLimit: 0,
			roleLimitMode: limitMode,
			accountBadges: JSON.stringify(badges),
			accountTier,
		} as any)
		.returning();

	await queueUserNotification(result.id, {
		type: "admin_override_created",
		title: "🔑 API Key Proxy Anda",
		message: formatPhantomCredentialsMessage({
			endpoint,
			apiKey: key,
			intro:
				"Admin Override aktif. Berikut kredensial akses API proxy:",
		}),
		endpoint,
		apiKey: key,
		newKey: key,
	} as any);

	return {
		keyId: result.id,
		apiKey: key,
		alreadyExists: false,
		keyName,
		endpoint,
		discordUsername,
	};
}
