import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inputLimitWeightPercentForHop } from "./counting.js";

describe("inputLimitWeightPercentForHop", () => {
  it("matches the graduated schedule", () => {
    assert.equal(inputLimitWeightPercentForHop(1), 100);
    assert.equal(inputLimitWeightPercentForHop(2), 0);
    assert.equal(inputLimitWeightPercentForHop(5), 0);
    assert.equal(inputLimitWeightPercentForHop(6), 10);
    assert.equal(inputLimitWeightPercentForHop(10), 10);
    assert.equal(inputLimitWeightPercentForHop(11), 20);
    assert.equal(inputLimitWeightPercentForHop(15), 20);
    assert.equal(inputLimitWeightPercentForHop(16), 30);
    assert.equal(inputLimitWeightPercentForHop(46), 90);
    assert.equal(inputLimitWeightPercentForHop(49), 90);
    assert.equal(inputLimitWeightPercentForHop(50), 100);
    assert.equal(inputLimitWeightPercentForHop(179), 100);
  });
});
