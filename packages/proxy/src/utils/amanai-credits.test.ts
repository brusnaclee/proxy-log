import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	estimateAmanaiCredits,
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
});
