import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeAnthropicToolsForUpstream } from "./anthropic-tools.js";

describe("normalizeAnthropicToolsForUpstream", () => {
  it("keeps classic Anthropic tools and strips type", () => {
    const out = normalizeAnthropicToolsForUpstream([
      {
        type: "function",
        name: "Bash",
        description: "Run shell",
        input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      },
    ]);
    assert.equal(out?.length, 1);
    assert.equal(out?.[0].name, "Bash");
    assert.equal((out?.[0] as any).type, undefined);
    assert.deepEqual(out?.[0].input_schema.required, ["command"]);
  });

  it("downgrades Claude Code bash_20250124 tools", () => {
    const out = normalizeAnthropicToolsForUpstream([
      { type: "bash_20250124", name: "bash" },
      { type: "text_editor_20250124", name: "str_replace_editor" },
      { type: "web_search_20250305", name: "web_search" },
    ]);
    assert.equal(out?.length, 3);
    assert.ok(out?.every((t) => (t as any).type === undefined));
    assert.equal(out?.[0].name, "bash");
    assert.equal(out?.[0].input_schema.required?.[0], "command");
    assert.equal(out?.[2].name, "web_search");
    assert.equal(out?.[2].input_schema.required?.[0], "query");
  });

  it("infers name from typed tools that omit name", () => {
    const out = normalizeAnthropicToolsForUpstream([{ type: "bash_20250124" }]);
    assert.equal(out?.[0].name, "bash");
  });

  it("accepts flat name+input_schema without type", () => {
    const out = normalizeAnthropicToolsForUpstream([
      { name: "read_file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
    ]);
    assert.equal(out?.[0].name, "read_file");
    assert.equal((out?.[0] as any).type, undefined);
  });

  it("returns undefined for junk", () => {
    assert.equal(normalizeAnthropicToolsForUpstream([null, {}, 5]), undefined);
    assert.equal(normalizeAnthropicToolsForUpstream([]), undefined);
  });
});
