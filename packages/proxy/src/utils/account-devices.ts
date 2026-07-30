/**
 * Device listing scoped the same way the max-devices gate counts.
 *
 * `maxDevices` is enforced across every API key sharing a `discord_user_id`
 * (see the account device query in routes/proxy.ts), and quota fields are kept
 * in sync between sibling keys. Listing devices per key therefore showed an
 * empty list on any key whose sibling happened to own the registered device,
 * while the user still got "Maximum device limit (N) reached." at the gate.
 */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { machineKeyOfDevice } from './device-slots.js';

/**
 * Key ids sharing an account with `apiKeyId` — the key itself plus any sibling
 * under the same `discord_user_id`. Use for device actions so a slot can be
 * freed from whichever key currently holds it.
 */
export function accountKeyIdsSql(apiKeyId: number): SQL {
	return sql`(
		SELECT owner.id FROM api_keys owner
		INNER JOIN api_keys viewed ON viewed.id = ${apiKeyId}
		WHERE owner.id = viewed.id
		   OR (viewed.discord_user_id IS NOT NULL
		       AND owner.discord_user_id = viewed.discord_user_id)
	)`;
}

export interface AccountDevice {
	id: number;
	apiKeyId: number;
	fingerprint: string;
	ipAddress: string | null;
	userAgentRaw: string | null;
	osDetected: string | null;
	deviceName: string | null;
	ideDetected: string | null;
	firstSeen: string;
	lastSeen: string;
	requestCount: number;
	isBlocked: boolean;
	/** Key the device row belongs to — may differ from the key being viewed. */
	ownerKeyId: number;
	ownerKeyName: string | null;
	/** False when the slot is held through a sibling key of the same account. */
	isCurrentKey: boolean;
	/** Rows collapsed into this slot (legacy fingerprints, duplicate rows). */
	mergedRows: number;
}

/**
 * Devices visible to `apiKeyId`: account-wide when the key is Discord-linked,
 * otherwise just that key's own rows.
 *
 * Rows are collapsed into machine slots with the same grouping
 * `countDistinctMachines` uses at the gate, so the list length equals the
 * number of slots consumed. Without this the list can show many rows per slot:
 * legacy fingerprints for one machine, plus outright duplicates left behind
 * because the `(api_key_id, fingerprint)` unique index could not be created.
 */
export async function listAccountDevices(
	apiKeyId: number,
): Promise<AccountDevice[]> {
	const rows = (
		await db.execute(sql`
			SELECT d.id,
			       d.api_key_id        AS "apiKeyId",
			       d.fingerprint,
			       d.ip_address        AS "ipAddress",
			       d.user_agent_raw    AS "userAgentRaw",
			       d.os_detected       AS "osDetected",
			       d.device_name       AS "deviceName",
			       d.ide_detected      AS "ideDetected",
			       d.first_seen        AS "firstSeen",
			       d.last_seen         AS "lastSeen",
			       d.request_count     AS "requestCount",
			       d.is_blocked        AS "isBlocked",
			       owner.id            AS "ownerKeyId",
			       owner.name          AS "ownerKeyName",
			       (owner.id = ${apiKeyId}) AS "isCurrentKey"
			FROM devices d
			INNER JOIN api_keys owner ON owner.id = d.api_key_id
			INNER JOIN api_keys viewed ON viewed.id = ${apiKeyId}
			WHERE owner.id = viewed.id
			   OR (viewed.discord_user_id IS NOT NULL
			       AND owner.discord_user_id = viewed.discord_user_id)
			ORDER BY d.last_seen DESC
		`)
	).rows as unknown as AccountDevice[];

	const slots = new Map<string, AccountDevice>();
	for (const row of rows) {
		const device = { ...row, isCurrentKey: !!row.isCurrentKey, mergedRows: 1 };
		const hint = machineKeyOfDevice(device);
		const slotKey =
			hint && hint !== 'unknown:' ? `m:${hint}` : `f:${device.fingerprint}`;

		const existing = slots.get(slotKey);
		if (!existing) {
			slots.set(slotKey, device);
			continue;
		}
		// Rows arrive newest-first, so the first one stays the representative.
		existing.mergedRows += 1;
		existing.requestCount += device.requestCount;
		existing.isBlocked = existing.isBlocked && device.isBlocked;
		// Prefer showing the slot against the key being viewed when it holds one.
		if (!existing.isCurrentKey && device.isCurrentKey) {
			existing.ownerKeyId = device.ownerKeyId;
			existing.ownerKeyName = device.ownerKeyName;
			existing.isCurrentKey = true;
		}
	}

	return [...slots.values()];
}
