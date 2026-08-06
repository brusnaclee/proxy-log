import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGE_COOLDOWN_MS, CHALLENGE_TTL_MS } from "./device-challenge.js";

describe("device challenge constants", () => {
	it("TTL is 30 minutes", () => {
		assert.equal(CHALLENGE_TTL_MS, 30 * 60 * 1000);
	});

	it("cooldown is 5 minutes", () => {
		assert.equal(CHALLENGE_COOLDOWN_MS, 5 * 60 * 1000);
	});
});

/**
 * Pure helpers mirroring deny → blacklist strike logic used by denyChallenge.
 * (DB-backed approve/deny covered by server E2E.)
 */
function strikesToBlacklist(priorDenyCount: number): boolean {
	// denyChallenge records this deny then checks count; 2nd deny blacklists
	return priorDenyCount + 1 >= 2;
}

describe("deny strike → blacklist", () => {
	it("first deny does not blacklist", () => {
		assert.equal(strikesToBlacklist(0), false);
	});

	it("second deny blacklists", () => {
		assert.equal(strikesToBlacklist(1), true);
	});
});
