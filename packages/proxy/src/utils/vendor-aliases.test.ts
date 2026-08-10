import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	normalizeVendorAliases,
	toPublicUpstreamId,
	toRealUpstreamId,
	toPublicModelId,
	publicizeModelString,
	publicizeMonitorModelId,
	expandUpstreamIdCandidates,
	type VendorAliasIndex,
} from "./vendor-aliases.js";

describe("vendor-aliases", () => {
	it("normalizes map and rejects collisions", () => {
		const map = normalizeVendorAliases({ amanai: "vibecode", tokito: "sapi2" });
		assert.equal(map.amanai, "vibecode");
		assert.throws(() => normalizeVendorAliases({ amanai: "vibecode", other: "amanai" }));
		assert.throws(() => normalizeVendorAliases({ amanai: "a/b" }));
	});

	it("maps public ↔ real upstream ids", () => {
		const aliases = { amanai: "vibecode" };
		assert.equal(toPublicUpstreamId("amanai/glm-5.2", aliases), "vibecode/glm-5.2");
		assert.equal(toRealUpstreamId("vibecode/glm-5.2", aliases), "amanai/glm-5.2");
		assert.equal(toRealUpstreamId("amanai/glm-5.2", aliases), "amanai/glm-5.2");
		assert.equal(
			toPublicModelId("phantom", "amanai/glm-5.2", aliases),
			"phantom/vibecode/glm-5.2",
		);
	});

	it("expands candidates for resolve", () => {
		const c = expandUpstreamIdCandidates("vibecode/glm-5.2", { amanai: "vibecode" });
		assert.ok(c.includes("vibecode/glm-5.2"));
		assert.ok(c.includes("amanai/glm-5.2"));
	});

	it("publicizeModelString handles provider prefix and auto()", () => {
		const index: VendorAliasIndex = {
			canonicalName: new Map([["phantom", "phantom"]]),
			byProviderName: new Map([["phantom", { amanai: "vibecode" }]]),
			reverseByProviderName: new Map([["phantom", new Map([["vibecode", "amanai"]])]]),
		};
		assert.equal(
			publicizeModelString("phantom/amanai/glm-5.2", index),
			"phantom/vibecode/glm-5.2",
		);
		assert.equal(
			publicizeModelString("auto (phantom/amanai/glm-5.2)", index),
			"auto (phantom/vibecode/glm-5.2)",
		);
		assert.equal(
			publicizeModelString("amanai/glm-5.2", index),
			"vibecode/glm-5.2",
		);
	});

	it("publicizeMonitorModelId rewrites nested vendor only", () => {
		const index: VendorAliasIndex = {
			canonicalName: new Map([["phantom", "phantom"]]),
			byProviderName: new Map([["phantom", { amanai: "vibecode" }]]),
			reverseByProviderName: new Map([["phantom", new Map([["vibecode", "amanai"]])]]),
		};
		assert.equal(
			publicizeMonitorModelId("phantom", "amanai/claude-haiku-4.5", index),
			"vibecode/claude-haiku-4.5",
		);
	});
});
