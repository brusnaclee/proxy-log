import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUsageBreakdownPeriod,
  resolveUsageBreakdownRange,
} from "./usage-aggregates.js";

test("usage breakdown accepts only rolling periods", () => {
  for (const period of ["1d", "3d", "7d", "30d"] as const) {
    assert.equal(parseUsageBreakdownPeriod(period), period);
  }
  assert.equal(parseUsageBreakdownPeriod(undefined), "1d");
  for (const invalid of ["today", "thisMonth", "allTime", "0d", "31d"]) {
    assert.throws(() => parseUsageBreakdownPeriod(invalid), /Invalid period/);
  }
});

test("usage breakdown periods are exact rolling windows", () => {
  const now = new Date("2026-08-15T16:00:00.000Z");
  assert.deepEqual(resolveUsageBreakdownRange("1d", now), {
    from: new Date("2026-08-14T16:00:00.000Z"),
    to: now,
  });
  assert.deepEqual(resolveUsageBreakdownRange("30d", now), {
    from: new Date("2026-07-16T16:00:00.000Z"),
    to: now,
  });
});
