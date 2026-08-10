import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	normalizeVendorAliases,
	toPublicUpstreamId,
	toRealUpstreamId,
	toRealUpstreamIdCandidates,
	toPublicModelId,
	toPublicLogModelId,
	publicizeModelString,
	publicizeMonitorModelId,
	expandUpstreamIdCandidates,
	findForbiddenRawVendor,
	realVendorsForClientVendor,
	type VendorAliasIndex,
} from "./vendor-aliases.js";

describe("vendor-aliases", () => {
	it("normalizes map and rejects duplicate public names", () => {
		const map = normalizeVendorAliases({ amanai: "vibecode", tokito: "sapi2" });
		assert.equal(map.amanai, "vibecode");
		assert.throws(() =>
			normalizeVendorAliases({ amanai: "vibecode", other: "vibecode" }),
		);
		assert.throws(() => normalizeVendorAliases({ amanai: "a/b" }));
	});

	it("allows public name to equal another upstream vendor (chain)", () => {
		const map = normalizeVendorAliases({ ikan: "amanai", tokito: "ikan" });
		assert.equal(map.ikan, "amanai");
		assert.equal(map.tokito, "ikan");
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

	it("collision candidates: amanai → natural + ikan", () => {
		const aliases = { ikan: "amanai", tokito: "ikan" };
		assert.deepEqual(realVendorsForClientVendor("amanai", aliases).sort(), [
			"amanai",
			"ikan",
		].sort());
		assert.deepEqual(realVendorsForClientVendor("ikan", aliases), ["tokito"]);
		assert.deepEqual(realVendorsForClientVendor("tokito", aliases), []);

		const c = toRealUpstreamIdCandidates("amanai/glm-5.2", aliases);
		assert.ok(c.includes("amanai/glm-5.2"));
		assert.ok(c.includes("ikan/glm-5.2"));
	});

	it("expands candidates for resolve", () => {
		const c = expandUpstreamIdCandidates("vibecode/glm-5.2", { amanai: "vibecode" });
		assert.ok(c.includes("vibecode/glm-5.2"));
		assert.ok(c.includes("amanai/glm-5.2"));
	});

	it("publicizeModelString handles provider prefix, auto(), and · tag", () => {
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
		assert.equal(
			publicizeModelString("phantom/amanai/glm-5.2 · ikan", index),
			"phantom/vibecode/glm-5.2 · ikan",
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

	it("findForbiddenRawVendor: raw-only dead names only", () => {
		const simple = { amanai: "vibecode" };
		assert.deepEqual(
			findForbiddenRawVendor("phantom/amanai/glm-5.2", "phantom", simple),
			{ rawVendor: "amanai", publicVendor: "vibecode" },
		);
		assert.equal(
			findForbiddenRawVendor("phantom/vibecode/glm-5.2", "phantom", simple),
			null,
		);

		const chain = { ikan: "amanai", tokito: "ikan" };
		// tokito is raw-only → forbidden
		assert.deepEqual(
			findForbiddenRawVendor("phantom/tokito/x", "phantom", chain),
			{ rawVendor: "tokito", publicVendor: "ikan" },
		);
		// ikan is aliased away BUT also public for tokito → allowed
		assert.equal(
			findForbiddenRawVendor("phantom/ikan/x", "phantom", chain),
			null,
		);
		// amanai is natural (not aliased) → allowed
		assert.equal(
			findForbiddenRawVendor("phantom/amanai/x", "phantom", chain),
			null,
		);
	});

	it("toPublicLogModelId annotates real vendor on collision", () => {
		const aliases = { ikan: "amanai", tokito: "ikan" };
		assert.equal(
			toPublicLogModelId("phantom", "ikan/glm-5.2", aliases, 2),
			"phantom/amanai/glm-5.2 · ikan",
		);
		assert.equal(
			toPublicLogModelId("phantom", "amanai/glm-5.2", aliases, 1),
			"phantom/amanai/glm-5.2",
		);
	});
});
