import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeToolCallArray } from "./tool-call-normalize.js";

describe("normalizeToolCallArray", () => {
	it("copies flat name/arguments into function when function is missing", () => {
		const toolCalls = [
			{
				id: "call_1",
				type: "function",
				name: "run_terminal_command",
				arguments: '{"command":"gh repo view"}',
			},
		];
		normalizeToolCallArray(toolCalls);
		assert.equal(toolCalls[0].function.name, "run_terminal_command");
		assert.equal(toolCalls[0].function.arguments, '{"command":"gh repo view"}');
		assert.equal(toolCalls[0].index, 0);
	});

	it("backfills empty nested function.name from flat name", () => {
		const toolCalls = [
			{
				id: "call_2",
				index: 0,
				name: "read_file",
				function: { name: "", arguments: "" },
				arguments: '{"path":"a.ts"}',
			},
		];
		normalizeToolCallArray(toolCalls);
		assert.equal(toolCalls[0].function.name, "read_file");
		assert.equal(toolCalls[0].function.arguments, '{"path":"a.ts"}');
	});

	it("does not invent unknown and keeps a real nested name", () => {
		const toolCalls = [
			{
				id: "call_3",
				function: { name: "  grep  ", arguments: "{}" },
			},
		];
		normalizeToolCallArray(toolCalls);
		assert.equal(toolCalls[0].function.name, "grep");
	});

	it("strips empty function.name on arguments-only continuation deltas", () => {
		// Chunk 2 shape from gcli/grok — name wiped to "" would break Grok Build.
		const toolCalls = [
			{
				index: 0,
				type: "function",
				function: { name: "", arguments: '{"command":"git clone x"}' },
			},
		];
		normalizeToolCallArray(toolCalls);
		assert.equal("name" in toolCalls[0].function, false);
		assert.equal(toolCalls[0].function.arguments, '{"command":"git clone x"}');
	});

	it("strips empty name when field was null", () => {
		const toolCalls = [{ function: { name: null, arguments: "partial" } }];
		normalizeToolCallArray(toolCalls);
		assert.equal("name" in toolCalls[0].function, false);
		assert.equal(toolCalls[0].function.arguments, "partial");
	});
});
