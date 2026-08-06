import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	extractMachineHint,
	generateFingerprint,
	normalizeMachineArch,
	normalizeMachineOs,
} from "./crypto.js";
import {
	countRegisteredSlots,
	findSameMachineDevice,
	pickOldestRegistered,
	siblingIdsToDeleteOnSameMachine,
} from "./device-slots.js";

describe("machine hint normalization", () => {
	it("aliases windows_nt/win64 to windows:x64", () => {
		assert.equal(normalizeMachineOs("windows_nt"), "windows");
		assert.equal(normalizeMachineArch("win64"), "x64");
		assert.equal(
			extractMachineHint("Cursor/1.0 (Windows NT 10.0; Win64; x64)"),
			"windows:x64",
		);
	});
});

describe("slot fingerprint (machine|ide)", () => {
	const ua = "Cursor/1.0 (Windows NT 10.0; Win64; x64)";

	it("different IDEs get different fingerprints on same machine", () => {
		const cursor = generateFingerprint("", ua, "", "Windows", "Cursor");
		const cline = generateFingerprint("", ua, "", "Windows", "Cline");
		assert.notEqual(cursor, cline);
	});

	it("same IDE version bump keeps the same slot", () => {
		const a = generateFingerprint("", "Cursor/1.0 (Windows NT 10.0; Win64; x64)", "", "Windows", "Cursor");
		const b = generateFingerprint("", "Cursor/2.5.1 (Windows NT 10.0; Win64; x64)", "", "Windows", "Cursor");
		assert.equal(a, b);
	});

	it("IP is ignored", () => {
		const a = generateFingerprint("1.1.1.1", ua, "", "Windows", "Cursor");
		const b = generateFingerprint("8.8.8.8", ua, "", "Windows", "Cursor");
		assert.equal(a, b);
	});
});

describe("registered slot counting", () => {
	const cursor = {
		id: 1,
		apiKeyId: 8,
		fingerprint: "fp-cursor",
		userAgentRaw: "Cursor/1.0 (Windows NT 10.0; Win64; x64)",
		osDetected: "Windows",
		ideDetected: "Cursor",
		isProvisional: false,
	};
	const cline = {
		id: 2,
		apiKeyId: 8,
		fingerprint: "fp-cline",
		userAgentRaw: "Cline/1.0 (Windows NT 10.0; Win64; x64)",
		osDetected: "Windows",
		ideDetected: "Cline",
		isProvisional: false,
	};
	const provisional = {
		id: 3,
		apiKeyId: 8,
		fingerprint: "fp-new",
		ideDetected: "Kilo",
		isProvisional: true,
	};

	it("counts Cursor+Cline as 2 slots", () => {
		assert.equal(countRegisteredSlots([cursor, cline]), 2);
	});

	it("ignores provisional devices in slot count", () => {
		assert.equal(countRegisteredSlots([cursor, cline, provisional]), 2);
	});

	it("does not merge Cursor onto Cline for same fingerprint lookup", () => {
		const match = findSameMachineDevice([cursor, cline], {
			canonicalFingerprint: "fp-kilo",
			userAgent: "Kilo/1.0",
			osDetected: "Windows",
			ideName: "Kilo",
		});
		assert.equal(match, null);
	});

	it("finds exact fingerprint match", () => {
		const match = findSameMachineDevice([cursor, cline], {
			canonicalFingerprint: "fp-cursor",
			userAgent: cursor.userAgentRaw,
			osDetected: "Windows",
			ideName: "Cursor",
		});
		assert.ok(match);
		assert.equal(match!.id, 1);
	});

	it("only deletes duplicate fingerprint siblings", () => {
		const dup = { ...cursor, id: 99, fingerprint: "fp-cursor" };
		const del = siblingIdsToDeleteOnSameMachine(
			[cursor, cline, dup],
			1,
			"windows:x64",
			"fp-cursor",
		);
		assert.deepEqual(del, [99]);
	});

	it("pickOldestRegistered by lastSeen", () => {
		const older = {
			...cursor,
			lastSeen: "2026-01-01T00:00:00Z",
			firstSeen: "2026-01-01T00:00:00Z",
		};
		const newer = {
			...cline,
			lastSeen: "2026-06-01T00:00:00Z",
			firstSeen: "2026-06-01T00:00:00Z",
		};
		const pick = pickOldestRegistered([newer, older, provisional]);
		assert.equal(pick?.id, older.id);
	});
});
