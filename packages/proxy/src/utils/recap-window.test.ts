import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getRecapWindow } from "./recap-window.js";

/** WIB wall-clock Date from UTC fields (month0 is 0-based). */
function wibDate(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d) - 7 * 60 * 60 * 1000);
}

describe("getRecapWindow target month", () => {
  it("days 1..5 target the PREVIOUS month", () => {
    const w = getRecapWindow(wibDate(2026, 7, 3));
    assert.equal(w.yearMonth, "2026-07");
    assert.equal(w.isOpen, true);
  });

  it("mid-month (after day 5, before openDay H-2) still targets CURRENT month", () => {
    const w = getRecapWindow(wibDate(2026, 7, 25)); // openDay = 29
    assert.equal(w.yearMonth, "2026-08");
    assert.equal(w.isOpen, false);
  });

  it("from openDay (H-2) through month end targets CURRENT month, open", () => {
    const w = getRecapWindow(wibDate(2026, 7, 29));
    assert.equal(w.yearMonth, "2026-08");
    assert.equal(w.isOpen, true);
  });

  it("range covers the 1st through the last day of the target month", async () => {
    const { getMonthRangeUtc } = await import("./recap-window.js");
    const { start, end } = getMonthRangeUtc("2026-08");
    assert.equal(start.toISOString(), "2026-07-31T17:00:00.000Z");
    assert.equal(end.toISOString(), "2026-08-31T17:00:00.000Z");
  });
});
