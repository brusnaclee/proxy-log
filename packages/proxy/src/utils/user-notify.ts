/**
 * Queue Discord DM (+ thread mirror by bot) for any key that has discordUserId.
 * No discordUserId → no-op (custom/unlinked keys stay silent).
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";

export type UserNotificationType =
	| "key_created"
	| "key_rotated"
	| "key_disabled"
	| "key_enabled"
	| "key_deleted"
	| "limits_changed"
	| "usage_reset"
	| "limit_reached"
	| "addon_assigned"
	| "addon_expired"
	| "admin_override_created"
	| "admin_bulk_rotate"
	| "portal_key_rotated";

export interface UserNotificationPayload {
	type: UserNotificationType | string;
	discordUserId: string;
	keyId?: number;
	title?: string;
	message?: string;
	endpoint?: string;
	newKey?: string;
	apiKey?: string;
	keyName?: string;
	alsoThread?: boolean;
	[key: string]: unknown;
}

function normalizeQueue(raw: string | null | undefined): any[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed;
		if (parsed && typeof parsed === "object") return [parsed];
	} catch {
		/* ignore */
	}
	return [];
}

/** Queue a user notification on the key row (bot polls pending_notification). */
export async function queueUserNotification(
	apiKeyId: number,
	payload: Omit<UserNotificationPayload, "discordUserId" | "keyId"> & {
		discordUserId?: string;
		type: string;
	},
): Promise<boolean> {
	const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1);
	if (!key) return false;
	const discordUserId = payload.discordUserId || key.discordUserId;
	if (!discordUserId) return false;

	const entry: UserNotificationPayload = {
		...payload,
		type: payload.type,
		discordUserId: String(discordUserId),
		keyId: apiKeyId,
		alsoThread: payload.alsoThread !== false,
		keyName: typeof payload.keyName === "string" ? payload.keyName : key.name,
	};

	const queue = normalizeQueue(key.pendingNotification);
	queue.push(entry);

	await db
		.update(apiKeys)
		.set({
			pendingNotification: JSON.stringify(queue),
			updatedAt: new Date(),
		})
		.where(eq(apiKeys.id, apiKeyId));
	return true;
}

/** Queue by discord user id (first active key, or any key). */
export async function queueUserNotificationByDiscord(
	discordUserId: string,
	payload: Omit<UserNotificationPayload, "discordUserId"> & { type: string },
): Promise<boolean> {
	if (!discordUserId) return false;
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
	const key = rows.find((k) => k.isActive) || rows[0];
	if (!key) {
		// No key yet — stash is impossible; caller should notify after key create
		return false;
	}
	return queueUserNotification(key.id, { ...payload, discordUserId });
}
