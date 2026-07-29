import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePeriodRange } from "./counting.js";
import { getMonthRangeUtc, previousYearMonth } from "./recap-window.js";

/** Current WIB "YYYY-MM" so the expectation follows the clock, not a fixture. */
function wibYearMonth(now = new Date()): string {
  const w = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, "0")}`;
}

describe("resolvePeriodRange month boundaries", () => {
  it("starts thisMonth at the same instant the recap month does", () => {
    const { start } = resolvePeriodRange("thisMonth");
    assert.equal(
      start.toISOString(),
      getMonthRangeUtc(wibYearMonth()).start.toISOString(),
    );
  });

  it("covers lastMonth exactly [prev month start, this month start)", () => {
    const ym = wibYearMonth();
    const range = resolvePeriodRange("lastMonth");
    assert.equal(
      range.start.toISOString(),
      getMonthRangeUtc(previousYearMonth(ym)).start.toISOString(),
    );
    assert.equal(
      range.end?.toISOString(),
      getMonthRangeUtc(ym).start.toISOString(),
    );
  });
});
