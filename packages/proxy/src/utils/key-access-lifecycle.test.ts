import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	canDisableKeyAccess,
	shouldKeepKeyAccess,
} from "./key-access-lifecycle.js";

describe("key access stay-alive policy", () => {
	it("keeps key for Phantom alone", () => {
		assert.equal(
			shouldKeepKeyAccess({ hasPhantom: true, hasStaff: false, hasActiveAddon: false }),
			true,
		);
	});
	it("keeps key for Staff alone", () => {
		assert.equal(
			shouldKeepKeyAccess({ hasPhantom: false, hasStaff: true, hasActiveAddon: false }),
			true,
		);
	});
	it("keeps key for add-on alone (e.g. firek override)", () => {
		assert.equal(
			shouldKeepKeyAccess({ hasPhantom: false, hasStaff: false, hasActiveAddon: true }),
			true,
		);
	});
	it("disables when only Pro/Premium-equivalent (no phantom/staff/addon)", () => {
		assert.equal(
			shouldKeepKeyAccess({ hasPhantom: false, hasStaff: false, hasActiveAddon: false }),
			false,
		);
	});
	it("keeps when Phantom gone but add-on still active", () => {
		assert.equal(
			shouldKeepKeyAccess({ hasPhantom: false, hasStaff: false, hasActiveAddon: true }),
			true,
		);
	});
	it("keeps Pro/Premium user while add-on is active (no Phantom)", () => {
		assert.equal(
			shouldKeepKeyAccess({ hasPhantom: false, hasStaff: false, hasActiveAddon: true }),
			true,
		);
	});
	it("Pro-only without add-on may be disabled when roles confirmed", () => {
		assert.equal(
			canDisableKeyAccess({
				rolesConfirmed: true,
				shouldKeep: shouldKeepKeyAccess({
					hasPhantom: false,
					hasStaff: false,
					hasActiveAddon: false,
				}),
			}),
			true,
		);
	});
});

describe("fail-open disable guard", () => {
	it("never disables when Discord roles are unconfirmed", () => {
		assert.equal(
			canDisableKeyAccess({ rolesConfirmed: false, shouldKeep: false }),
			false,
		);
	});
	it("disables only when roles confirmed and shouldKeep is false", () => {
		assert.equal(
			canDisableKeyAccess({ rolesConfirmed: true, shouldKeep: false }),
			true,
		);
	});
	it("does not disable when confirmed keep (Phantom/Staff/addon)", () => {
		assert.equal(
			canDisableKeyAccess({ rolesConfirmed: true, shouldKeep: true }),
			false,
		);
	});
});
