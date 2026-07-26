import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyBatch, getBatchPrompt, usesLegacyFunctionsOnly } from "./batch.js";

function toolsBody(overrides: any = {}) {
	return {
		messages: [
			{ role: "user", content: "read all the auth files and fix the bug" },
		],
		tools: [
			{ type: "function", function: { name: "read_file", parameters: {} } },
		],
		...overrides,
	};
}

describe("usesLegacyFunctionsOnly", () => {
	it("true when only legacy `functions` array present", () => {
		const body = { functions: [{ name: "read_file" }] };
		assert.equal(usesLegacyFunctionsOnly(body), true);
	});
	it("false when modern `tools` array present, even alongside functions", () => {
		const body = { functions: [{ name: "read_file" }], tools: [{ type: "function", function: { name: "read_file" } }] };
		assert.equal(usesLegacyFunctionsOnly(body), false);
	});
	it("false when neither present", () => {
		assert.equal(usesLegacyFunctionsOnly({}), false);
	});
});

describe("applyBatch", () => {
	it("injects a single tagged system message at the top", () => {
		const body = toolsBody();
		const applied = applyBatch(body);
		assert.equal(applied, true);
		assert.equal(body.messages[0].role, "system");
		assert.match(body.messages[0].content, /^\[token-saver:batch\]/);
		assert.equal(body.messages[0].content.includes(getBatchPrompt()), true);
	});

	it("preserves original message order after the injected system message", () => {
		const body = toolsBody();
		const originalFirst = body.messages[0];
		applyBatch(body);
		assert.equal(body.messages.length, 2);
		assert.equal(body.messages[1], originalFirst);
	});

	it("returns false and does not mutate when body has no messages array", () => {
		const body = { tools: [] } as any;
		const applied = applyBatch(body);
		assert.equal(applied, false);
		assert.equal(body.messages, undefined);
	});

	it("skips injection for legacy singular functions-only requests", () => {
		const body = {
			messages: [{ role: "user", content: "hi" }],
			functions: [{ name: "read_file" }],
		};
		const applied = applyBatch(body);
		assert.equal(applied, false);
		assert.equal(body.messages.length, 1);
	});

	it("still injects when both legacy functions and modern tools are present", () => {
		const body = toolsBody({ functions: [{ name: "read_file" }] });
		const applied = applyBatch(body);
		assert.equal(applied, true);
	});
});
