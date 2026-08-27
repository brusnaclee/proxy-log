import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	consumeStreamPayload,
	finalizeCompletion,
	makeAccumulator,
	resolveBillableTokens,
} from "./token-extractor.js";
import {
	anthropicUsageToOpenAI,
	convertStreamEvent,
	createStreamState,
} from "./anthropic-adapter.js";

describe("anthropicUsageToOpenAI", () => {
	it("maps Anthropic uncached+cache_read into OpenAI total prompt + cached_tokens", () => {
		const u = anthropicUsageToOpenAI({
			input_tokens: 400,
			output_tokens: 50,
			cache_read_input_tokens: 1600,
			cache_creation_input_tokens: 0,
		}) as any;
		assert.equal(u.prompt_tokens, 2000);
		assert.equal(u.prompt_tokens_details.cached_tokens, 1600);
		assert.equal(u.completion_tokens, 50);
	});

	it("omits prompt fields on output-only delta", () => {
		const u = anthropicUsageToOpenAI({
			output_tokens: 12,
		} as any) as any;
		assert.equal(u.prompt_tokens, undefined);
		assert.equal(u.completion_tokens, 12);
	});
});

describe("Anthropic SSE usage → billable", () => {
	it("message_start cache + message_delta output merges into logs", () => {
		const acc = makeAccumulator();
		consumeStreamPayload(acc, {
			type: "message_start",
			message: {
				id: "msg_1",
				usage: {
					input_tokens: 500,
					output_tokens: 0,
					cache_read_input_tokens: 1500,
				},
			},
		});
		consumeStreamPayload(acc, {
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: { output_tokens: 80 },
		});
		const finalized = finalizeCompletion(acc);
		assert.equal(finalized.promptTokens, 2000);
		assert.equal(finalized.cachedTokens, 1500);
		assert.equal(finalized.completionTokens, 80);
		const billable = resolveBillableTokens(finalized, 0, "hello");
		assert.equal(billable.promptTokens, 500);
		assert.equal(billable.cachedTokens, 1500);
		assert.equal(billable.completionTokens, 80);
	});

	it("convertStreamEvent message_start forwards usage to OpenAI chunk", () => {
		const state = createStreamState("claude");
		const event =
			'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","model":"claude","usage":{"input_tokens":100,"output_tokens":0,"cache_read_input_tokens":900}}}\n\n';
		const lines = convertStreamEvent(event, state);
		assert.ok(lines.length >= 1);
		const payload = JSON.parse(lines[0].replace(/^data: /, ""));
		assert.equal(payload.usage.prompt_tokens, 1000);
		assert.equal(payload.usage.prompt_tokens_details.cached_tokens, 900);

		const acc = makeAccumulator();
		consumeStreamPayload(acc, payload);
		consumeStreamPayload(acc, {
			usage: { completion_tokens: 20 },
		});
		const fin = finalizeCompletion(acc);
		assert.equal(fin.promptTokens, 1000);
		assert.equal(fin.cachedTokens, 900);
		assert.equal(fin.completionTokens, 20);
		const billable = resolveBillableTokens(fin, 0, "x");
		assert.equal(billable.promptTokens, 100);
		assert.equal(billable.cachedTokens, 900);
	});
});

describe("tool_call preview includes function name", () => {
	it("records name from streaming deltas into response preview text", () => {
		const acc = makeAccumulator();
		consumeStreamPayload(acc, {
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								function: { name: "run_terminal_command", arguments: "" },
							},
						],
					},
				},
			],
		});
		consumeStreamPayload(acc, {
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								function: { arguments: '{"command":"ls"}' },
							},
						],
					},
				},
			],
		});
		const fin = finalizeCompletion(acc);
		assert.match(fin.completionText, /\[tool_call:0 run_terminal_command/);
		assert.match(fin.completionText, /"command":"ls"/);
	});
});
