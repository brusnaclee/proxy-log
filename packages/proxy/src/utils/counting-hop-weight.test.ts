import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inputLimitWeightPercentForHop } from "./hop-weight.js";
import {
  setTokenLimitWeightConfigCache,
  inputLimitWeightPercentForHop as cachedHopWeight,
  inputHopWeightSqlExpr,
} from "./counting.js";

describe("hop-weight first_rest_flat (default)", () => {
  it("hop1=100%, later=flat%", () => {
    assert.equal(inputLimitWeightPercentForHop(1, "first_rest_flat", 10), 100);
    assert.equal(inputLimitWeightPercentForHop(2, "first_rest_flat", 10), 10);
    assert.equal(inputLimitWeightPercentForHop(50, "first_rest_flat", 10), 10);
  });
});

describe("hop-weight flat_all / full / custom", () => {
  it("flat_all applies to hop1", () => {
    assert.equal(inputLimitWeightPercentForHop(1, "flat_all", 10), 10);
    assert.equal(inputLimitWeightPercentForHop(9, "flat_all", 25), 25);
  });
  it("full is always 100", () => {
    assert.equal(inputLimitWeightPercentForHop(1, "full", 10), 100);
    assert.equal(inputLimitWeightPercentForHop(99, "full", 10), 100);
  });
  it("custom ranges", () => {
    const ranges = [
      { fromHop: 1, toHop: 1, percent: 100 },
      { fromHop: 2, toHop: 10, percent: 0 },
      { fromHop: 11, toHop: 999, percent: 20 },
    ];
    assert.equal(inputLimitWeightPercentForHop(1, "custom", 10, ranges), 100);
    assert.equal(inputLimitWeightPercentForHop(5, "custom", 10, ranges), 0);
    assert.equal(inputLimitWeightPercentForHop(11, "custom", 10, ranges), 20);
    assert.equal(inputLimitWeightPercentForHop(1000, "custom", 10, ranges), 0);
  });
});

describe("counting cache + SQL expr", () => {
  it("reflects first_rest_flat in SQL", () => {
    setTokenLimitWeightConfigCache({ mode: "first_rest_flat", percent: 10, custom: [] });
    assert.equal(cachedHopWeight(1), 100);
    assert.equal(cachedHopWeight(3), 10);
    assert.match(inputHopWeightSqlExpr(), /rn = 1 THEN 1\.0/);
    assert.match(inputHopWeightSqlExpr(), /0\.1/);
  });
  it("custom SQL lists ranges", () => {
    setTokenLimitWeightConfigCache({
      mode: "custom",
      percent: 10,
      custom: [{ fromHop: 1, toHop: 5, percent: 50 }],
    });
    assert.match(inputHopWeightSqlExpr(), /BETWEEN 1 AND 5/);
    assert.match(inputHopWeightSqlExpr(), /0\.5/);
  });
});
