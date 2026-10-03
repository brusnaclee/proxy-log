import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createResponsesSseState,
  responsesSseFromChatPayload,
  finalizeResponsesSse,
} from "./responses-sse.js";

function eventNames(chunks: string[]): string[] {
  return chunks
    .flatMap((c) => c.split("\n\n"))
    .filter(Boolean)
    .map((block) => {
      const line = block.split("\n").find((l) => l.startsWith("event:"));
      return line ? line.slice(6).trim() : "?";
    });
}

function eventBlocks(chunks: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const chunk of chunks) {
    for (const block of chunk.split("\n\n")) {
      if (!block) continue;
      const name = block.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim();
      const data = block.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (name && data) (out[name] ||= []).push(data);
    }
  }
  return out;
}

describe("responses sse agent loop", () => {
  it("closes a function_call item so the client keeps looping", () => {
    const state = createResponsesSseState(1);
    const chunks = [
      ...responsesSseFromChatPayload(state, {
        id: "chatcmpl-1",
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "shell", arguments: '{"cmd"' } }] } }],
      }),
      ...responsesSseFromChatPayload(state, {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"ls"}' } }] } }],
      }),
      ...responsesSseFromChatPayload(state, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ...finalizeResponsesSse(state),
    ];
    const names = eventNames(chunks);
    assert.ok(names.includes("response.output_item.done"), names.join(","));
    const done = JSON.parse(eventBlocks(chunks)["response.output_item.done"][0]);
    assert.equal(done.item.type, "function_call");
    assert.equal(done.item.status, "completed");
    assert.equal(done.item.arguments, '{"cmd":"ls"}');
  });

  it("keeps tool_calls alive instead of ending the turn at the user", () => {
    const state = createResponsesSseState(2);
    const chunks = [
      ...responsesSseFromChatPayload(state, {
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "shell", arguments: "{}" } }] } }],
      }),
      ...responsesSseFromChatPayload(state, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ...finalizeResponsesSse(state),
    ];
    const events = eventBlocks(chunks);
    assert.equal(events["response.output_item.done"]?.length, 1);
    const done = JSON.parse(events["response.output_item.done"][0]);
    assert.equal(done.item.type, "function_call");
    // The turn must not also emit a completed message item.
    assert.ok(!chunks.join("").includes('"role":"assistant"'));
    assert.ok(events["response.completed"], "response.completed must exist");
  });

  it("accumulates streamed argument fragments", () => {
    const state = createResponsesSseState(3);
    const chunks = [
      ...responsesSseFromChatPayload(state, {
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_b", function: { name: "run", arguments: '{"a"' } }] } }],
      }),
      ...responsesSseFromChatPayload(state, {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }],
      }),
      ...responsesSseFromChatPayload(state, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    ];
    const done = JSON.parse(eventBlocks(chunks)["response.output_item.done"][0]);
    assert.equal(done.item.arguments, '{"a":1}');
  });

  it("closes a dangling message item when text precedes a tool call", () => {
    const state = createResponsesSseState(5);
    const chunks = [
      ...responsesSseFromChatPayload(state, { choices: [{ delta: { content: "Let me look." } }] }),
      ...responsesSseFromChatPayload(state, {
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_m", function: { name: "shell", arguments: '{"command":["ls"]}' } }] } }],
      }),
      ...responsesSseFromChatPayload(state, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    ];
    const names = eventNames(chunks);
    assert.equal(names.filter((n) => n === "response.output_item.added").length, 2);
    const doneBlocks = eventBlocks(chunks)["response.output_item.done"];
    assert.equal(doneBlocks.length, 2, "both the message and the call must be closed");
    const completed = JSON.parse(eventBlocks(chunks)["response.completed"][0]);
    const kinds = completed.response.output.map((o: { type: string }) => o.type);
    assert.deepEqual(kinds, ["message", "function_call"]);
    assert.equal((doneBlocks as string[]).length, 2);
  });

  it("still completes a plain text answer", () => {
    const state = createResponsesSseState(4);
    const chunks = [
      ...responsesSseFromChatPayload(state, { choices: [{ delta: { content: "hi" } }] }),
      ...responsesSseFromChatPayload(state, { choices: [{ delta: {}, finish_reason: "stop" }] }),
    ];
    const names = eventNames(chunks);
    assert.ok(names.includes("response.output_text.delta"));
    assert.ok(names.includes("response.completed"));
  });
});