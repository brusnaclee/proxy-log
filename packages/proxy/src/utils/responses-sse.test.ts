import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	createResponsesSseState,
	finalizeResponsesSse,
	responsesSseFromChatPayload,
} from "./responses-sse.js";

describe("responses-sse", () => {
	it("emits response.completed even if stream ends without [DONE] text", () => {
		const state = createResponsesSseState(1);
		const mid = responsesSseFromChatPayload(state, {
			id: "chatcmpl-abc",
			choices: [{ delta: { content: "hi" } }],
		});
		assert.ok(mid.some((s) => s.includes("response.output_text.delta")));
		assert.equal(state.completed, false);

		const end = finalizeResponsesSse(state);
		assert.ok(end.some((s) => s.includes("event: response.completed")));
		assert.ok(end.some((s) => s.includes('"status":"completed"')));
		assert.equal(state.completed, true);

		// idempotent
		assert.equal(finalizeResponsesSse(state).length, 0);
	});

	it("finalizes on finish_reason stop", () => {
		const state = createResponsesSseState(2);
		responsesSseFromChatPayload(state, {
			choices: [{ delta: { content: "ok" } }],
		});
		const fin = responsesSseFromChatPayload(state, {
			choices: [{ delta: {}, finish_reason: "stop" }],
		});
		assert.ok(fin.some((s) => s.includes("response.completed")));
	});
});
