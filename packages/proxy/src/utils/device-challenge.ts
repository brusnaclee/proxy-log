/**
 * Device challenge flow: maxDevices slots with 30m confirm (Discord + portal).
 * Approve → replace oldest registered. Deny once → drop provisional.
 * Deny twice for same fingerprint → blacklist.
 */

import { randomBytes } from 'crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
	allowedDevices,
	apiKeys,
	deviceChallenges,
	devices,
	userNotifications,
} from '../db/schema.js';
import { pickOldestRegistered } from './device-slots.js';

export const CHALLENGE_TTL_MS = 30 * 60 * 1000;
export const CHALLENGE_COOLDOWN_MS = 5 * 60 * 1000;

function newToken(): string {
	return randomBytes(16).toString('hex');
}

async function accountKeyIds(discordUserId: string | null | undefined, apiKeyId: number): Promise<number[]> {
	if (!discordUserId) return [apiKeyId];
	const rows = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(eq(apiKeys.discordUserId, discordUserId));
	const ids = rows.map((r) => r.id);
	return ids.length ? ids : [apiKeyId];
}

export async function countFingerprintDenies(
	discordUserId: string,
	fingerprint: string,
): Promise<number> {
	const rows = await db
		.select({ id: deviceChallenges.id })
		.from(deviceChallenges)
		.where(
			and(
				eq(deviceChallenges.discordUserId, discordUserId),
				eq(deviceChallenges.fingerprint, fingerprint),
				eq(deviceChallenges.status, 'denied'),
			),
		);
	return rows.length;
}

export async function isFingerprintBlacklisted(
	keyIds: number[],
	fingerprint: string,
): Promise<boolean> {
	if (!keyIds.length) return false;
	const rows = await db
		.select({ id: allowedDevices.id })
		.from(allowedDevices)
		.where(
			and(
				inArray(allowedDevices.apiKeyId, keyIds),
				eq(allowedDevices.fingerprint, fingerprint),
				eq(allowedDevices.listType, 'block'),
			),
		)
		.limit(1);
	return rows.length > 0;
}

/** Always enforce block rows even when devicePolicy is none. */
export async function findOpenChallenge(
	discordUserId: string,
	fingerprint: string,
): Promise<typeof deviceChallenges.$inferSelect | null> {
	const now = new Date();
	const [row] = await db
		.select()
		.from(deviceChallenges)
		.where(
			and(
				eq(deviceChallenges.discordUserId, discordUserId),
				eq(deviceChallenges.fingerprint, fingerprint),
				eq(deviceChallenges.status, 'pending'),
				gt(deviceChallenges.expiresAt, now),
			),
		)
		.orderBy(desc(deviceChallenges.createdAt))
		.limit(1);
	return row || null;
}

export async function expireStaleChallenges(discordUserId?: string): Promise<number> {
	const now = new Date();
	const cond = discordUserId
		? and(
				eq(deviceChallenges.status, 'pending'),
				sql`${deviceChallenges.expiresAt} <= ${now}`,
				eq(deviceChallenges.discordUserId, discordUserId),
			)
		: and(
				eq(deviceChallenges.status, 'pending'),
				sql`${deviceChallenges.expiresAt} <= ${now}`,
			);

	const stale = await db.select().from(deviceChallenges).where(cond as any);
	if (!stale.length) return 0;

	for (const ch of stale) {
		await db
			.update(deviceChallenges)
			.set({ status: 'expired', resolvedAt: now })
			.where(eq(deviceChallenges.id, ch.id));
		await db
			.delete(devices)
			.where(
				and(
					eq(devices.fingerprint, ch.fingerprint),
					eq(devices.isProvisional, true),
					inArray(
						devices.apiKeyId,
						await accountKeyIds(ch.discordUserId, ch.apiKeyId),
					),
				),
			);
	}
	return stale.length;
}

export type OpenChallengeResult = {
	challenge: typeof deviceChallenges.$inferSelect;
	created: boolean;
	notificationId: number | null;
};

/**
 * Create or reuse a pending challenge; insert provisional device; write portal notif + pending DM hook.
 */
export async function openOrReuseChallenge(opts: {
	discordUserId: string;
	apiKeyId: number;
	fingerprint: string;
	ideDetected: string | null;
	userAgentRaw: string;
	ipAddress: string;
}): Promise<OpenChallengeResult> {
	await expireStaleChallenges(opts.discordUserId);

	const existing = await findOpenChallenge(opts.discordUserId, opts.fingerprint);
	if (existing) {
		return { challenge: existing, created: false, notificationId: null };
	}

	// Cooldown: if a recent pending/expired for same FP was created <5m ago, reuse window by creating anyway only if last was expired/denied
	const [recent] = await db
		.select()
		.from(deviceChallenges)
		.where(
			and(
				eq(deviceChallenges.discordUserId, opts.discordUserId),
				eq(deviceChallenges.fingerprint, opts.fingerprint),
			),
		)
		.orderBy(desc(deviceChallenges.createdAt))
		.limit(1);

	if (
		recent &&
		recent.status === 'pending' &&
		recent.expiresAt.getTime() > Date.now()
	) {
		return { challenge: recent, created: false, notificationId: null };
	}

	if (
		recent &&
		Date.now() - new Date(recent.createdAt).getTime() < CHALLENGE_COOLDOWN_MS &&
		recent.status !== 'approved'
	) {
		// Soft cooldown: still allow access via provisional if row exists; else create
	}

	const token = newToken();
	const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
	const [challenge] = await db
		.insert(deviceChallenges)
		.values({
			discordUserId: opts.discordUserId,
			apiKeyId: opts.apiKeyId,
			fingerprint: opts.fingerprint,
			ideDetected: opts.ideDetected,
			userAgentRaw: opts.userAgentRaw,
			ipAddress: opts.ipAddress,
			status: 'pending',
			token,
			expiresAt,
		})
		.returning();

	// Upsert provisional device on this key
	const [existingDev] = await db
		.select()
		.from(devices)
		.where(
			and(eq(devices.apiKeyId, opts.apiKeyId), eq(devices.fingerprint, opts.fingerprint)),
		)
		.limit(1);
	if (existingDev) {
		await db
			.update(devices)
			.set({
				isProvisional: true,
				lastSeen: new Date(),
				ideDetected: opts.ideDetected,
				userAgentRaw: opts.userAgentRaw,
				ipAddress: opts.ipAddress,
			})
			.where(eq(devices.id, existingDev.id));
	} else {
		await db.insert(devices).values({
			apiKeyId: opts.apiKeyId,
			fingerprint: opts.fingerprint,
			ipAddress: opts.ipAddress,
			userAgentRaw: opts.userAgentRaw,
			ideDetected: opts.ideDetected,
			isProvisional: true,
			requestCount: 0,
		});
	}

	const ideLabel = opts.ideDetected || 'Unknown IDE';
	const title = 'Device baru terdeteksi';
	const message =
		`IDE/client baru (**${ideLabel}**) ingin akses. Slot penuh (max devices). ` +
		`Konfirmasi dalam 30 menit: **Ya itu saya** (ganti device tertua) atau **Bukan saya** (tolak).`;

	const [notif] = await db
		.insert(userNotifications)
		.values({
			discordUserId: opts.discordUserId,
			type: 'device_confirm',
			title,
			message,
			payload: JSON.stringify({
				challengeId: challenge.id,
				token,
				fingerprint: opts.fingerprint,
				ideDetected: opts.ideDetected,
				expiresAt: expiresAt.toISOString(),
				apiKeyId: opts.apiKeyId,
			}),
			actionableUntil: expiresAt,
		})
		.returning();

	// Mirror to pending_notification for Discord bot poll (do not replace whole queue)
	const { queueUserNotification } = await import('./user-notify.js');
	await queueUserNotification(opts.apiKeyId, {
		type: 'device_confirm',
		title,
		message,
		challengeId: challenge.id,
		token,
		fingerprint: opts.fingerprint,
		ideDetected: opts.ideDetected,
		expiresAt: expiresAt.toISOString(),
		discordUserId: opts.discordUserId,
	});

	return { challenge, created: true, notificationId: notif?.id ?? null };
}

export async function approveChallenge(
	challengeId: number,
	token: string,
	actorDiscordUserId: string,
): Promise<{ ok: boolean; error?: string }> {
	const [ch] = await db
		.select()
		.from(deviceChallenges)
		.where(eq(deviceChallenges.id, challengeId))
		.limit(1);
	if (!ch) return { ok: false, error: 'Challenge not found' };
	if (ch.discordUserId !== actorDiscordUserId) return { ok: false, error: 'Forbidden' };
	if (ch.token !== token) return { ok: false, error: 'Invalid token' };
	if (ch.status !== 'pending') return { ok: false, error: `Already ${ch.status}` };
	if (ch.expiresAt.getTime() <= Date.now()) {
		await expireStaleChallenges(ch.discordUserId);
		return { ok: false, error: 'Challenge expired' };
	}

	const keyIds = await accountKeyIds(ch.discordUserId, ch.apiKeyId);
	const accountRows = (
		await db.execute(sql`
			SELECT d.* FROM devices d
			WHERE d.api_key_id IN (${sql.join(keyIds.map((id) => sql`${id}`), sql`, `)})
			  AND d.is_blocked = false
		`)
	).rows as any[];

	const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, ch.apiKeyId)).limit(1);
	const max = key?.maxDevices || 0;
	const registered = accountRows.filter((d) => !d.is_provisional);
	if (max > 0 && registered.length >= max) {
		const oldest = pickOldestRegistered(accountRows);
		if (oldest) {
			await db.delete(devices).where(eq(devices.id, Number(oldest.id)));
		}
	}

	// Promote provisional → registered (or insert)
	const [prov] = await db
		.select()
		.from(devices)
		.where(
			and(
				inArray(devices.apiKeyId, keyIds),
				eq(devices.fingerprint, ch.fingerprint),
			),
		)
		.limit(1);

	if (prov) {
		await db
			.update(devices)
			.set({
				isProvisional: false,
				lastSeen: new Date(),
				ideDetected: ch.ideDetected,
				userAgentRaw: ch.userAgentRaw,
				ipAddress: ch.ipAddress,
			})
			.where(eq(devices.id, prov.id));
	} else {
		await db.insert(devices).values({
			apiKeyId: ch.apiKeyId,
			fingerprint: ch.fingerprint,
			ipAddress: ch.ipAddress,
			userAgentRaw: ch.userAgentRaw,
			ideDetected: ch.ideDetected,
			isProvisional: false,
			requestCount: 0,
		});
	}

	await db
		.update(deviceChallenges)
		.set({ status: 'approved', resolvedAt: new Date() })
		.where(eq(deviceChallenges.id, ch.id));

	return { ok: true };
}

export async function denyChallenge(
	challengeId: number,
	token: string,
	actorDiscordUserId: string,
): Promise<{ ok: boolean; blacklisted?: boolean; error?: string }> {
	const [ch] = await db
		.select()
		.from(deviceChallenges)
		.where(eq(deviceChallenges.id, challengeId))
		.limit(1);
	if (!ch) return { ok: false, error: 'Challenge not found' };
	if (ch.discordUserId !== actorDiscordUserId) return { ok: false, error: 'Forbidden' };
	if (ch.token !== token) return { ok: false, error: 'Invalid token' };
	if (ch.status !== 'pending') return { ok: false, error: `Already ${ch.status}` };
	// Allow deny even if expired (user clicked late) — still drop provisional
	void (ch.expiresAt.getTime() <= Date.now());

	const keyIds = await accountKeyIds(ch.discordUserId, ch.apiKeyId);
	await db
		.delete(devices)
		.where(
			and(
				inArray(devices.apiKeyId, keyIds),
				eq(devices.fingerprint, ch.fingerprint),
				eq(devices.isProvisional, true),
			),
		);

	await db
		.update(deviceChallenges)
		.set({ status: 'denied', resolvedAt: new Date() })
		.where(eq(deviceChallenges.id, ch.id));

	const denies = await countFingerprintDenies(ch.discordUserId, ch.fingerprint);
	let blacklisted = false;
	if (denies >= 2) {
		for (const kid of keyIds) {
			const [exists] = await db
				.select()
				.from(allowedDevices)
				.where(
					and(
						eq(allowedDevices.apiKeyId, kid),
						eq(allowedDevices.fingerprint, ch.fingerprint),
						eq(allowedDevices.listType, 'block'),
					),
				)
				.limit(1);
			if (!exists) {
				await db.insert(allowedDevices).values({
					apiKeyId: kid,
					fingerprint: ch.fingerprint,
					label: `auto-deny ${ch.ideDetected || 'device'}`,
					listType: 'block',
				});
			}
		}
		blacklisted = true;
	}

	return { ok: true, blacklisted };
}

export async function listPortalNotifications(discordUserId: string, limit = 50) {
	await expireStaleChallenges(discordUserId);
	return db
		.select()
		.from(userNotifications)
		.where(eq(userNotifications.discordUserId, discordUserId))
		.orderBy(desc(userNotifications.createdAt))
		.limit(limit);
}

export async function listPendingChallengesForUser(discordUserId: string) {
	await expireStaleChallenges(discordUserId);
	return db
		.select()
		.from(deviceChallenges)
		.where(
			and(
				eq(deviceChallenges.discordUserId, discordUserId),
				eq(deviceChallenges.status, 'pending'),
				gt(deviceChallenges.expiresAt, new Date()),
			),
		)
		.orderBy(desc(deviceChallenges.createdAt));
}
