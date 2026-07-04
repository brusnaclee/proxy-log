import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convertOpenAIChunkToAnthropicEvents,
  convertRequestToAnthropic,
  createAnthropicStreamState,
  flushAnthropicStream,
  splitAnthropicSseEvents,
} from "./anthropic-adapter.js";

describe("anthropic-adapter", () => {
  it("batches consecutive tool messages into one user message", () => {
    const result = convertRequestToAnthropic({
      model: "claude-sonnet-4",
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "t1", content: "a" },
        { role: "tool", tool_call_id: "t2", content: "b" },
      ],
      max_tokens: 1024,
    });

    const toolUsers = result.messages.filter(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.every((b) => b.type === "tool_result"),
    );
    assert.equal(toolUsers.length, 1);
    assert.equal((toolUsers[0].content as any[]).length, 2);
  });

  it("emits message_start only once and uses thinking_delta for reasoning", () => {
    const state = createAnthropicStreamState("test-model");
    const chunk1 =
      'data: {"choices":[{"delta":{"reasoning_content":"think"},"index":0}]}';
    const chunk2 = 'data: {"choices":[{"delta":{"content":"hi"},"index":0}]}';

    const out1 = convertOpenAIChunkToAnthropicEvents(chunk1, state);
    const out2 = convertOpenAIChunkToAnthropicEvents(chunk2, state);

    assert.match(out1, /message_start/);
    assert.match(out1, /thinking_delta/);
    assert.doesNotMatch(out2, /message_start/);
    assert.match(out2, /text_delta/);
  });

  it("flushAnthropicStream is idempotent", () => {
    const state = createAnthropicStreamState("test-model");
    convertOpenAIChunkToAnthropicEvents(
      'data: {"choices":[{"delta":{"content":"x"},"index":0}]}',
      state,
    );
    const first = flushAnthropicStream(state);
    const second = flushAnthropicStream(state);
    assert.ok(first.includes("message_stop"));
    assert.equal(second, "");
  });

  it("splitAnthropicSseEvents preserves partial events across chunks", () => {
    const part1 = 'event: message_start\ndata: {"type":"message_start"}\n\n';
    const split1 = splitAnthropicSseEvents(part1);
    assert.equal(split1.events.length, 1);
    assert.equal(split1.remainder, "");

    const part2 =
      part1 + 'event: content_block_delta\ndata: {"type":"content_block_delta"';
    const split2 = splitAnthropicSseEvents(part2);
    assert.equal(split2.events.length, 1);
    assert.ok(split2.remainder.includes("content_block_delta"));

    const split3 = splitAnthropicSseEvents(
      split2.remainder + ',"delta":{"type":"text_delta","text":"hello"}}\n\n',
    );
    assert.equal(split3.events.length, 1);
    assert.match(split3.events[0], /hello/);
  });
});
