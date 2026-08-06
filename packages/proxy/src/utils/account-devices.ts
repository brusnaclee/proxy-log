/**
 * Device listing scoped the same way the max-devices gate counts.
 *
 * Slots = distinct fingerprints (machine|ide). Provisional rows are included
 * but flagged. Account-scoped when Discord-linked.
 */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';

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
	isProvisional: boolean;
	ownerKeyId: number;
	ownerKeyName: string | null;
	isCurrentKey: boolean;
	mergedRows: number;
}

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
			       COALESCE(d.is_provisional, false) AS "isProvisional",
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
		const device = {
			...row,
			isCurrentKey: !!row.isCurrentKey,
			isProvisional: !!row.isProvisional,
			mergedRows: 1,
		};
		const slotKey = `f:${device.fingerprint}`;
		const existing = slots.get(slotKey);
		if (!existing) {
			slots.set(slotKey, device);
			continue;
		}
		existing.mergedRows += 1;
		existing.requestCount += device.requestCount;
		existing.isBlocked = existing.isBlocked || device.isBlocked;
		existing.isProvisional = existing.isProvisional && device.isProvisional;
		if (!existing.isCurrentKey && device.isCurrentKey) {
			existing.ownerKeyId = device.ownerKeyId;
			existing.ownerKeyName = device.ownerKeyName;
			existing.isCurrentKey = true;
		}
	}

	return [...slots.values()];
}
