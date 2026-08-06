/**
 * Server E2E for device challenge flow (sandbox key, cleaned up).
 *
 *   cd /root/proxy-log/packages/proxy && pnpm exec tsx scripts/e2e-device-challenge.ts
 *
 * Or from repo root after deploy:
 *   node -e "..."  (prefer tsx path above)
 */
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import {
	allowedDevices,
	apiKeys,
	deviceChallenges,
	devices,
	userNotifications,
} from "../src/db/schema.js";
import { generateApiKey, generateFingerprint, sha256 } from "../src/utils/crypto.js";
import {
	approveChallenge,
	denyChallenge,
	expireStaleChallenges,
	openOrReuseChallenge,
} from "../src/utils/device-challenge.js";
import { countRegisteredSlots } from "../src/utils/device-slots.js";

const DISCORD = `e2e_device_${Date.now()}`;

function fp(ide: string) {
	return generateFingerprint(
		"",
		`${ide}/1.0 (Windows NT 10.0; Win64; x64)`,
		"",
		"Windows",
		ide,
	);
}

async function cleanup(keyId: number) {
	await db.delete(userNotifications).where(eq(userNotifications.discordUserId, DISCORD));
	await db.delete(deviceChallenges).where(eq(deviceChallenges.discordUserId, DISCORD));
	await db.delete(allowedDevices).where(eq(allowedDevices.apiKeyId, keyId));
	await db.delete(devices).where(eq(devices.apiKeyId, keyId));
	await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
}

async function main() {
	const rawKey = generateApiKey();
	const [key] = await db
		.insert(apiKeys)
		.values({
			name: `e2e-device-challenge`,
			key: rawKey,
			keyHash: sha256(rawKey),
			keyPrefix: rawKey.slice(0, 12),
			discordUserId: DISCORD,
			maxDevices: 2,
			isActive: true,
		})
		.returning();

	const keyId = key.id;
	console.log("sandbox key", keyId, DISCORD);

	try {
		const fpA = fp("Cursor");
		const fpB = fp("Cline");
		const fpC = fp("Kilo");

		await db.insert(devices).values([
			{
				apiKeyId: keyId,
				fingerprint: fpA,
				ideDetected: "Cursor",
				userAgentRaw: "Cursor/1.0 (Windows NT 10.0; Win64; x64)",
				isProvisional: false,
				requestCount: 1,
				lastSeen: new Date("2026-01-01T00:00:00Z"),
				firstSeen: new Date("2026-01-01T00:00:00Z"),
			},
			{
				apiKeyId: keyId,
				fingerprint: fpB,
				ideDetected: "Cline",
				userAgentRaw: "Cline/1.0 (Windows NT 10.0; Win64; x64)",
				isProvisional: false,
				requestCount: 1,
				lastSeen: new Date("2026-06-01T00:00:00Z"),
				firstSeen: new Date("2026-06-01T00:00:00Z"),
			},
		]);

		let rows = await db.select().from(devices).where(eq(devices.apiKeyId, keyId));
		assert(countRegisteredSlots(rows) === 2, "expected 2 registered");

		// 3rd → challenge + provisional
		const opened = await openOrReuseChallenge({
			discordUserId: DISCORD,
			apiKeyId: keyId,
			fingerprint: fpC,
			ideDetected: "Kilo",
			userAgentRaw: "Kilo/1.0 (Windows NT 10.0; Win64; x64)",
			ipAddress: "127.0.0.1",
		});
		assert(opened.created || opened.challenge, "challenge opened");
		const ch = opened.challenge;
		assert(ch.status === "pending", "pending");

		rows = await db.select().from(devices).where(eq(devices.apiKeyId, keyId));
		assert(rows.some((d) => d.fingerprint === fpC && d.isProvisional), "provisional C");
		assert(countRegisteredSlots(rows) === 2, "still 2 registered while provisional");

		// Approve → oldest (Cursor) gone, C registered
		const ap = await approveChallenge(ch.id, ch.token, DISCORD);
		assert(ap.ok, `approve: ${ap.error}`);
		rows = await db.select().from(devices).where(eq(devices.apiKeyId, keyId));
		assert(!rows.some((d) => d.fingerprint === fpA), "oldest removed");
		assert(rows.some((d) => d.fingerprint === fpC && !d.isProvisional), "C registered");
		assert(countRegisteredSlots(rows) === 2, "still max 2 after approve");

		// Fill again: remove one slot path — add Cursor back as registered, challenge Cline-new
		await db.delete(devices).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fpB)));
		await db.insert(devices).values({
			apiKeyId: keyId,
			fingerprint: fpA,
			ideDetected: "Cursor",
			isProvisional: false,
			lastSeen: new Date("2026-01-01T00:00:00Z"),
			firstSeen: new Date("2026-01-01T00:00:00Z"),
		});
		const fpD = fp("OpenCode");
		const open2 = await openOrReuseChallenge({
			discordUserId: DISCORD,
			apiKeyId: keyId,
			fingerprint: fpD,
			ideDetected: "OpenCode",
			userAgentRaw: "OpenCode/1.0",
			ipAddress: "127.0.0.1",
		});
		const ch2 = open2.challenge;
		const d1 = await denyChallenge(ch2.id, ch2.token, DISCORD);
		assert(d1.ok && !d1.blacklisted, "first deny no blacklist");
		rows = await db.select().from(devices).where(eq(devices.apiKeyId, keyId));
		assert(!rows.some((d) => d.fingerprint === fpD), "provisional removed on deny");

		const open3 = await openOrReuseChallenge({
			discordUserId: DISCORD,
			apiKeyId: keyId,
			fingerprint: fpD,
			ideDetected: "OpenCode",
			userAgentRaw: "OpenCode/1.0",
			ipAddress: "127.0.0.1",
		});
		const ch3 = open3.challenge;
		const d2 = await denyChallenge(ch3.id, ch3.token, DISCORD);
		assert(d2.ok && d2.blacklisted, "second deny blacklists");
		const blocks = await db
			.select()
			.from(allowedDevices)
			.where(
				and(
					eq(allowedDevices.apiKeyId, keyId),
					eq(allowedDevices.fingerprint, fpD),
					eq(allowedDevices.listType, "block"),
				),
			);
		assert(blocks.length >= 1, "block rule present");

		// Expire flow: open challenge then force-expire
		await db.delete(allowedDevices).where(eq(allowedDevices.apiKeyId, keyId));
		const fpE = fp("Windsurf");
		const open4 = await openOrReuseChallenge({
			discordUserId: DISCORD,
			apiKeyId: keyId,
			fingerprint: fpE,
			ideDetected: "Windsurf",
			userAgentRaw: "Windsurf/1.0",
			ipAddress: "127.0.0.1",
		});
		await db
			.update(deviceChallenges)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(deviceChallenges.id, open4.challenge.id));
		const n = await expireStaleChallenges(DISCORD);
		assert(n >= 1, "expired at least one");
		rows = await db.select().from(devices).where(eq(devices.apiKeyId, keyId));
		assert(!rows.some((d) => d.fingerprint === fpE && d.isProvisional), "provisional cleared on expire");

		// maxDevices=0 / 99 regression: just assert sandbox was 2
		assert(key.maxDevices === 2, "sandbox maxDevices=2");

		console.log("E2E device challenge: ALL PASSED");
	} finally {
		await cleanup(keyId);
		const { pool } = await import("../src/db/index.js");
		await pool.end();
	}
}

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) {
		console.error("FAIL:", msg);
		process.exit(1);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
