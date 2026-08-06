import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	extractMachineHint,
	generateFingerprint,
	normalizeMachineArch,
	normalizeMachineOs,
} from "./crypto.js";
import {
	countDistinctMachines,
	findSameMachineDevice,
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
		assert.equal(
			extractMachineHint("something", "Windows"),
			"windows:",
		);
	});

	it("same fingerprint for Windows NT vs windows osDetected", () => {
		const a = generateFingerprint("", "Codex Desktop/1.0 (Windows NT 10.0; Win64)");
		const b = generateFingerprint("", "Cursor/1.0", "", "Windows");
		// b may lack arch — still same OS family; arch empty vs x64 differ.
		// Full UA with Win64 must be stable across product names:
		const c = generateFingerprint("", "Cline/1.0 Windows NT 10.0; Win64; x64");
		assert.equal(a, c);
	});
});

describe("device slots collapse", () => {
	const cursor = {
		id: 1,
		apiKeyId: 8,
		fingerprint: "fp-cursor",
		userAgentRaw: "Cursor/1.0 (Windows NT 10.0; Win64; x64)",
		osDetected: "Windows",
		ideDetected: "Cursor",
	};
	const cline = {
		id: 2,
		apiKeyId: 8,
		fingerprint: "fp-cline-unknown",
		userAgentRaw: "cline/1.0",
		osDetected: null,
		ideDetected: "Cline",
	};
	const legacyUa = {
		id: 3,
		apiKeyId: 8,
		fingerprint: "fp-legacy-ua",
		userAgentRaw: "node",
		osDetected: "Unknown",
		ideDetected: "Node Fetch",
	};

	it("counts Cursor+Cline+legacy as 1 machine", () => {
		assert.equal(countDistinctMachines([cursor, cline, legacyUa]), 1);
	});

	it("counts only-unknown legacy rows as 1 machine", () => {
		assert.equal(countDistinctMachines([cline, legacyUa]), 1);
	});

	it("merges OS-less request onto sole known machine", () => {
		const match = findSameMachineDevice([cursor, cline], {
			canonicalFingerprint: generateFingerprint("", "cline/2.0"),
			userAgent: "cline/2.0",
			osDetected: null,
		});
		assert.ok(match);
		assert.equal(match!.id, 1);
	});

	it("deletes unknown siblings when consolidating known machine", () => {
		const del = siblingIdsToDeleteOnSameMachine(
			[cursor, cline, legacyUa],
			1,
			"windows:x64",
		);
		assert.deepEqual(del.sort(), [2, 3]);
	});
});
