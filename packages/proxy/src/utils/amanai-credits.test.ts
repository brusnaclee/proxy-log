import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	computeUpstreamCreditsForHop,
	estimateAmanaiCredits,
	estimateAmanaiCreditParts,
	estimateAmanaiCreditsForLogRow,
	resolveAmanaiMultipliers,
} from "./amanai-credits.js";

describe("amanai credits", () => {
	it("applies 1000 credit floor", () => {
		const c = estimateAmanaiCredits({
			promptTokens: 1,
			cachedTokens: 0,
			completionTokens: 1,
			mIn: 1,
			mOut: 1,
		});
		assert.equal(c, 1000);
	});

	it("matches worked billing shape (cache discounted)", () => {
		// billable 2013, cache 0, out 3, m_in=5.6 m_out=28 → ceil(11356.8)=11357
		const c = estimateAmanaiCredits({
			promptTokens: 2013,
			cachedTokens: 0,
			completionTokens: 3,
			mIn: 5.6,
			mOut: 28,
			mCache: 1.4,
			minCredits: 0,
		});
		assert.equal(c, 11357);
	});

	it("resolves nested client model ids", () => {
		const m = resolveAmanaiMultipliers("phantom/amanai/glm-5.2");
		assert.ok(m);
		assert.equal(m!.mIn, 6.03472);
	});

	it("resolves auto (model) labels", () => {
		const m = resolveAmanaiMultipliers("auto (glm-5.1) [stream]");
		assert.ok(m);
		assert.equal(m!.mIn, 4.2273);
	});

	it("estimates from log row (billable + cache)", () => {
		const { credits, multipliers } = estimateAmanaiCreditsForLogRow({
			model: "amanai/glm-5.2",
			promptTokens: 500,
			cachedTokens: 1500,
			completionTokens: 10,
		});
		assert.ok(multipliers);
		assert.ok(credits >= 1000);
	});

	it("computeUpstreamCreditsForHop returns 0 when not amanai compat", () => {
		assert.equal(
			computeUpstreamCreditsForHop({
				model: "amanai/glm-5.2",
				promptTokens: 1000,
				cachedTokens: 0,
				completionTokens: 10,
				amanaiCompat: false,
			}),
			0,
		);
	});

	it("computeUpstreamCreditsForHop meters Claude-scale input", () => {
		const c = computeUpstreamCreditsForHop({
			model: "amanai/claude-sonnet-4.6",
			promptTokens: 60000,
			cachedTokens: 0,
			completionTokens: 11,
			amanaiCompat: true,
		});
		// ~60k * 12.1 + 11 * 60.5 ≈ 726k+ — far above raw 60k tokens
		assert.ok(c > 500_000, `expected >500k credits, got ${c}`);
	});

	it("splits credits into in + out that sum to total", () => {
		const parts = estimateAmanaiCreditParts({
			promptTokens: 1000,
			cachedTokens: 0,
			completionTokens: 100,
			mIn: 6,
			mOut: 30,
			minCredits: 0,
		});
		assert.equal(parts.total, parts.inCredits + parts.outCredits);
		assert.equal(parts.outCredits, 3000); // 100 * 30
		assert.equal(parts.inCredits, 6000); // 1000 * 6
	});

	it("attributes floor leftover to input", () => {
		const parts = estimateAmanaiCreditParts({
			promptTokens: 1,
			cachedTokens: 0,
			completionTokens: 1,
			mIn: 1,
			mOut: 1,
		});
		assert.equal(parts.total, 1000);
		assert.equal(parts.outCredits, 1);
		assert.equal(parts.inCredits, 999);
	});
});
