import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollTestimonialDailyTokens } from "./recap-testimonial-reward.js";

function scripted(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

describe("rollTestimonialDailyTokens", () => {
  it("lands 1–3 jt on the low band", () => {
    assert.equal(rollTestimonialDailyTokens(scripted([0.0, 0.0])), 1_000_000);
    assert.equal(rollTestimonialDailyTokens(scripted([0.19, 0.99])), 3_000_000);
  });

  it("lands 4–6 jt on the middle band", () => {
    assert.equal(rollTestimonialDailyTokens(scripted([0.2, 0.0])), 4_000_000);
    assert.equal(rollTestimonialDailyTokens(scripted([0.5, 0.5])), 5_000_000);
    assert.equal(rollTestimonialDailyTokens(scripted([0.79, 0.99])), 6_000_000);
  });

  it("lands 7–10 jt on the high band", () => {
    assert.equal(rollTestimonialDailyTokens(scripted([0.8, 0.0])), 7_000_000);
    assert.equal(rollTestimonialDailyTokens(scripted([0.99, 0.99])), 10_000_000);
  });

  it("stays inside 1–10 jt and averages near 5 jt", () => {
    let low = 0;
    let mid = 0;
    let high = 0;
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const millions = rollTestimonialDailyTokens() / 1_000_000;
      assert.ok(millions >= 1 && millions <= 10 && Number.isInteger(millions));
      sum += millions;
      if (millions <= 3) low++;
      else if (millions <= 6) mid++;
      else high++;
    }
    const avg = sum / n;
    assert.ok(avg > 4.7 && avg < 5.5, `avg ${avg}`);
    assert.ok(low / n > 0.16 && low / n < 0.24, `low ${low / n}`);
    assert.ok(mid / n > 0.55 && mid / n < 0.65, `mid ${mid / n}`);
    assert.ok(high / n > 0.16 && high / n < 0.24, `high ${high / n}`);
  });
});
