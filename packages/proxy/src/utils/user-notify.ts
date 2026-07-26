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

/**
 * Same credentials template as Phantom claim DM (OpenAI A + Anthropic B).
 * Override / rotate / phantom all share this; only trial uses a different template.
 */
export function formatPhantomCredentialsMessage(opts: {
	endpoint: string;
	apiKey: string;
	intro?: string;
}): string {
	const endpoint = opts.endpoint.replace(/\/$/, "");
	const intro = opts.intro || "Berikut kredensial akses API proxy Anda:";
	return (
		`${intro}\n\n` +
		`**A. Untuk OpenAI-compatible clients (Cline, Codex, OpenCode, Cursor):**\n` +
		"```\n" +
		`Endpoint:   ${endpoint}\n` +
		`Authorization: Bearer ${opts.apiKey}\n` +
		"```\n" +
		`Contoh: \`${endpoint}/chat/completions\`\n\n` +
		`**B. Untuk Anthropic clients (Claude Code, Anthropic SDK):**\n` +
		`Proxy auto-translate \`/v1/messages\` (Anthropic) ↔ \`/v1/chat/completions\` (OpenAI). ` +
		`Set env vars berikut:\n` +
		"```bash\n" +
		`export ANTHROPIC_BASE_URL="${endpoint}"\n` +
		`export ANTHROPIC_AUTH_TOKEN="${opts.apiKey}"\n` +
		`export ANTHROPIC_DEFAULT_SONNET_MODEL="<groupy-model-id>"\n` +
		`export ANTHROPIC_DEFAULT_HAIKU_MODEL="<groupy-model-id>"\n` +
		`export ANTHROPIC_DEFAULT_OPUS_MODEL="<groupy-model-id>"\n` +
		`export API_TIMEOUT_MS=500000\n` +
		"```\n" +
		`Untuk bantuan setup di IDE: buka Discord DM bot ini dan klik "How to Use".\n\n` +
		`**Peraturan Penggunaan:**\n` +
		`• Maksimal device mengikuti setting key Anda\n` +
		`• Jika key direvoke admin karena pelanggaran, hubungi admin\n\n` +
		`Simpan key ini baik-baik. Jika bocor, hubungi admin untuk rotate key.`
	);
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
		return false;
	}
	return queueUserNotification(key.id, { ...payload, discordUserId });
}
