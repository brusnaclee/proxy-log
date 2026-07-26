import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	getPortalPrimaryKeyIds,
	pickPrimaryNonTrialKey,
	sortKeysPrimaryFirst,
} from "./api-key-primary.js";

describe("pickPrimaryNonTrialKey", () => {
	it("prefers admin-override over older discord-bot", () => {
		const keys = [
			{ id: 1, isTrial: false, isActive: true, provisionedBy: "discord-bot" },
			{ id: 99, isTrial: false, isActive: true, provisionedBy: "admin-override" },
		];
		const primary = pickPrimaryNonTrialKey(keys);
		assert.equal(primary?.id, 99);
	});

	it("prefers active discord-bot over inactive override", () => {
		const keys = [
			{ id: 1, isTrial: false, isActive: true, provisionedBy: "discord-bot" },
			{ id: 99, isTrial: false, isActive: false, provisionedBy: "admin-override" },
		];
		const primary = pickPrimaryNonTrialKey(keys);
		assert.equal(primary?.id, 1);
	});

	it("ignores trial keys", () => {
		const keys = [
			{ id: 1, isTrial: true, isActive: true, provisionedBy: "trial-bot" },
			{ id: 2, isTrial: false, isActive: true, provisionedBy: "discord-bot" },
		];
		assert.equal(pickPrimaryNonTrialKey(keys)?.id, 2);
	});
});

describe("sortKeysPrimaryFirst", () => {
	it("puts override primary before portal extras stably", () => {
		const keys = [
			{ id: 50, isTrial: false, provisionedBy: "portal" },
			{ id: 10, isTrial: false, provisionedBy: "discord-bot" },
			{ id: 20, isTrial: false, provisionedBy: "admin-override" },
		];
		const sorted = sortKeysPrimaryFirst(keys);
		assert.equal(sorted[0].id, 20);
		assert.deepEqual(
			sorted.map((k) => k.id),
			[20, 10, 50],
		);
		assert.ok(getPortalPrimaryKeyIds(keys).includes(20));
	});
});
