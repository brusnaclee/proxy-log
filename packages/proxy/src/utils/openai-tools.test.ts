import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeToolsForUpstream } from "./openai-tools.js";

describe("normalizeToolsForUpstream", () => {
  it("passes canonical nested tools through unchanged", () => {
    const nested = {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    };
    assert.deepEqual(normalizeToolsForUpstream([nested]), [nested]);
  });

  it("keeps strict when the client sent it", () => {
    const strictTool = {
      type: "function",
      function: {
        name: "a",
        parameters: { type: "object", properties: {} },
        strict: true,
      },
    };
    assert.deepEqual(normalizeToolsForUpstream([strictTool]), [strictTool]);
  });

  it("nests flat Responses-style tools (this was a 502 upstream)", () => {
    const out = normalizeToolsForUpstream([
      { type: "function", name: "read_file", description: "Read", parameters: { type: "object", properties: {} } },
    ]);
    assert.equal(out?.length, 1);
    assert.equal(out?.[0].type, "function");
    assert.equal(out?.[0].function.name, "read_file");
    // The flat shape is what upstream rejected with "invalid request".
    assert.equal((out?.[0] as any).name, undefined);
  });

  it("downgrades non-function tools instead of dropping them", () => {
    const out = normalizeToolsForUpstream([
      { type: "local_shell" },
      { type: "web_search" },
      { type: "custom", name: "apply_patch", description: "patch" },
    ]);
    assert.equal(out?.length, 3);
    const localShell = out?.find((t) => t.function.name === "local_shell");
    assert.deepEqual(localShell?.function.parameters, {
      type: "object",
      properties: { command: { type: "array", items: { type: "string" } } },
      required: ["command"],
    });
    const search = out?.find((t) => t.function.name === "web_search");
    assert.deepEqual(search?.function.parameters, {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
    const custom = out?.find((t) => t.function.name === "apply_patch");
    assert.equal(custom?.function.description, "patch");
  });

  it("supplies a schema when a nested tool omits parameters", () => {
    const out = normalizeToolsForUpstream([
      { type: "function", function: { name: "shell" } },
    ]);
    assert.deepEqual(out?.[0].function.parameters, {
      type: "object",
      properties: {},
      additionalProperties: true,
    });
  });

  it("drops junk and nameless entries", () => {
    assert.equal(normalizeToolsForUpstream([null, 5, "x", {}, { type: "function" }]), undefined);
    assert.equal(normalizeToolsForUpstream([]), undefined);
    assert.equal(normalizeToolsForUpstream(undefined), undefined);
  });

  it("returns undefined when every entry is unusable so tool_choice cannot dangle", () => {
    assert.equal(normalizeToolsForUpstream([null, {}]), undefined);
  });
});