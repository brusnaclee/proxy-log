import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	GROK_TRANSIENT_MAX_ATTEMPTS,
	grokTransientBackoffMs,
	isGrokCliModel,
	isGrokTransientErrorBody,
	parseGrokResetAfterMs,
} from "./grok-resilience.js";
import { resolveReasoningProfile, shouldInjectStreamReasoningBackfill } from "./reasoning-profile.js";

describe("isGrokCliModel", () => {
	it("matches gcli / grok-cli / grok- ids", () => {
		assert.equal(isGrokCliModel("tokito/gcli/grok-4.5"), true);
		assert.equal(isGrokCliModel("gcli/grok-4.5"), true);
		assert.equal(isGrokCliModel("grok-cli/grok-4.5"), true);
		assert.equal(isGrokCliModel("tokito/glm/glm-5.2"), false);
		assert.equal(isGrokCliModel("auto"), false);
	});
});

describe("isGrokTransientErrorBody", () => {
	it("detects grep_search invalid-argument", () => {
		const body =
			'[grok-cli/grok-4.5] [400]: {"code":"invalid-argument","error":"grep_search: tool parameter root must be an object type ( (reset after 11s)"}';
		assert.equal(isGrokTransientErrorBody(body), true);
		assert.equal(parseGrokResetAfterMs(body), 11_000);
		assert.equal(grokTransientBackoffMs(1, body), 11_000);
	});

	it("caps reset-after", () => {
		assert.equal(parseGrokResetAfterMs("reset after 99s"), 15_000);
	});

	it("falls back exponential without reset", () => {
		assert.equal(grokTransientBackoffMs(1, "grep_search invalid-argument object"), 1000);
		assert.equal(grokTransientBackoffMs(3, "grep_search invalid-argument object"), 4000);
	});

	it("ignores unrelated 400", () => {
		assert.equal(isGrokTransientErrorBody('{"error":"model not found"}'), false);
	});
});

describe("GROK_TRANSIENT_MAX_ATTEMPTS", () => {
	it("is 3-5 range", () => {
		assert.ok(GROK_TRANSIENT_MAX_ATTEMPTS >= 3);
		assert.ok(GROK_TRANSIENT_MAX_ATTEMPTS <= 5);
	});
});

describe("resolveReasoningProfile", () => {
	it("keep_separate for Continue / Pi / Cursor", () => {
		assert.equal(resolveReasoningProfile("Continue"), "keep_separate");
		assert.equal(resolveReasoningProfile("Pi Agent"), "keep_separate");
		assert.equal(resolveReasoningProfile("Cursor"), "keep_separate");
		assert.equal(resolveReasoningProfile("Claude Code"), "keep_separate");
	});
	it("strip for OpenCode / Kilo", () => {
		assert.equal(resolveReasoningProfile("OpenCode"), "strip");
		assert.equal(resolveReasoningProfile("Kilo"), "strip");
	});
	it("backfill for Hermes / unknown", () => {
		assert.equal(resolveReasoningProfile("Hermes"), "backfill");
		assert.equal(resolveReasoningProfile("Node.js Client"), "backfill");
		assert.equal(resolveReasoningProfile(""), "backfill");
	});
});

describe("shouldInjectStreamReasoningBackfill", () => {
	it("injects only for backfill with reasoning and no content", () => {
		assert.equal(
			shouldInjectStreamReasoningBackfill({
				profile: "backfill",
				sawPlainContent: false,
				reasoningText: "think",
			}),
			true,
		);
		assert.equal(
			shouldInjectStreamReasoningBackfill({
				profile: "backfill",
				sawPlainContent: true,
				reasoningText: "think",
			}),
			false,
		);
		assert.equal(
			shouldInjectStreamReasoningBackfill({
				profile: "keep_separate",
				sawPlainContent: false,
				reasoningText: "think",
			}),
			false,
		);
	});
});
