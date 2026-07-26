import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Mirror of keep policy (pure) — keep in sync with key-access-lifecycle.ts
function shouldKeep(opts: {
	hasPhantom: boolean;
	hasStaff: boolean;
	hasActiveAddon: boolean;
}) {
	return !!(opts.hasPhantom || opts.hasStaff || opts.hasActiveAddon);
}

describe("key access stay-alive policy", () => {
	it("keeps key for Phantom alone", () => {
		assert.equal(shouldKeep({ hasPhantom: true, hasStaff: false, hasActiveAddon: false }), true);
	});
	it("keeps key for Staff alone", () => {
		assert.equal(shouldKeep({ hasPhantom: false, hasStaff: true, hasActiveAddon: false }), true);
	});
	it("keeps key for add-on alone (e.g. firek override)", () => {
		assert.equal(shouldKeep({ hasPhantom: false, hasStaff: false, hasActiveAddon: true }), true);
	});
	it("disables when only Pro/Premium-equivalent (no phantom/staff/addon)", () => {
		assert.equal(shouldKeep({ hasPhantom: false, hasStaff: false, hasActiveAddon: false }), false);
	});
	it("keeps when Phantom gone but add-on still active", () => {
		assert.equal(shouldKeep({ hasPhantom: false, hasStaff: false, hasActiveAddon: true }), true);
	});
});
