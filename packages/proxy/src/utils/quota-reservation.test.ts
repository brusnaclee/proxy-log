import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	countReserved,
	formatResetEta,
	globalPromptBucketKey,
	modelPromptBucketKey,
	msUntilNextWibMidnight,
	releaseReservedTurn,
	tryReserveTurn,
} from "./quota-reservation.js";

describe("quota-reservation", () => {
	it("blocks concurrent reserves past limit", () => {
		const key = modelPromptBucketKey([64], "pat:claude") + ":test-" + Date.now();
		const windowMs = 86_400_000;
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "t1", limit: 2, dbUsed: 0, windowMs }),
			true,
		);
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "t2", limit: 2, dbUsed: 0, windowMs }),
			true,
		);
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "t3", limit: 2, dbUsed: 0, windowMs }),
			false,
		);
		assert.equal(countReserved(key, windowMs), 2);
	});

	it("counts dbUsed against limit", () => {
		const key = modelPromptBucketKey([1], "model:x") + ":db-" + Date.now();
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "a", limit: 5, dbUsed: 5, windowMs: 3600_000 }),
			false,
		);
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "b", limit: 5, dbUsed: 4, windowMs: 3600_000 }),
			true,
		);
	});

	it("globalPromptBucketKey is stable", () => {
		assert.equal(globalPromptBucketKey([3, 1]), globalPromptBucketKey([1, 3]));
	});

	it("msUntilNextWibMidnight is within a day", () => {
		const ms = msUntilNextWibMidnight();
		assert.ok(ms > 0 && ms <= 86_400_000);
		assert.match(formatResetEta(ms), /WIB/);
	});

	it("releaseReservedTurn frees a soft slot", () => {
		const key = modelPromptBucketKey([9], "pat:x") + ":rel-" + Date.now();
		const windowMs = 86_400_000;
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "r1", limit: 1, dbUsed: 0, windowMs }),
			true,
		);
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "r2", limit: 1, dbUsed: 0, windowMs }),
			false,
		);
		assert.equal(releaseReservedTurn(key, "r1"), true);
		assert.equal(countReserved(key, windowMs), 0);
		assert.equal(
			tryReserveTurn({ scopeKey: key, turnId: "r2", limit: 1, dbUsed: 0, windowMs }),
			true,
		);
	});
});
