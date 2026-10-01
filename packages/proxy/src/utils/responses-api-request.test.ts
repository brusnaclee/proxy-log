import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Shape-only replicas of the /v1/responses → /v1/chat/completions conversion
 * in packages/proxy/src/routes/proxy.ts. Kept in sync manually so the tool
 * handling stays testable without booting the whole route.
 */
export function responsesContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (c: any) =>
          c &&
          (c.type === "output_text" || c.type === "input_text" || c.type === "text" || c.type === "summary_text") &&
          typeof c.text === "string",
      )
      .map((c: any) => c.text)
      .join("");
    if (text) return text;
    return JSON.stringify(content);
  }
  return JSON.stringify(content);
}

export function convertResponsesInput(input: unknown): any[] {
  const messages: any[] = [];
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input as any[]) {
      if (item.role && item.content !== undefined) {
        messages.push({
          role: item.role === "developer" ? "system" : item.role,
          content: responsesContentToText(item.content),
        });
      } else if (item.type === "function_call_output" || item.type === "tool_result") {
        const output = item.output ?? item.content ?? item.result ?? "";
        messages.push({
          role: "tool",
          tool_call_id: item.call_id || item.tool_call_id || item.id || "",
          content: typeof output === "string" ? output : JSON.stringify(output),
        });
      } else if (item.type === "function_call") {
        const fnArgs = item.arguments ?? item.input ?? item.args ?? "{}";
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: item.call_id || item.id || `call_${messages.length}`,
              type: "function",
              function: {
                name: item.name || "",
                arguments: typeof fnArgs === "string" ? fnArgs : JSON.stringify(fnArgs),
              },
            },
          ],
        });
      } else if (item.type === "message" && item.content) {
        messages.push({ role: item.role || "user", content: responsesContentToText(item.content) });
      }
    }
  }
  return messages;
}

export function convertResponsesTools(tools: unknown): any[] {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t: any) => {
      if (!t || typeof t !== "object") return null;
      if (t.function && typeof t.function === "object") return t;
      const type = String(t.type || "function");
      if (type !== "function") return null;
      const fn = t.function;
      const name = String(fn?.name || t.name || "").trim();
      if (!name) return null;
      return {
        type: "function",
        function: {
          name,
          description: fn?.description ?? t.description,
          parameters:
            fn?.parameters ?? t.parameters ?? { type: "object", properties: {}, additionalProperties: true },
          strict: fn?.strict ?? t.strict,
        },
      };
    })
    .filter(Boolean);
}

describe("responses api conversion", () => {
  it("keeps plain string input", () => {
    assert.deepEqual(convertResponsesInput("hi"), [{ role: "user", content: "hi" }]);
  });

  it("maps developer role to system", () => {
    const out = convertResponsesInput([
      { role: "developer", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    assert.deepEqual(out, [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
  });

  it("flattens message blocks", () => {
    const out = convertResponsesInput([
      { type: "message", role: "user", content: [{ type: "input_text", text: "he" }, { type: "input_text", text: "llo" }] },
    ]);
    assert.deepEqual(out, [{ role: "user", content: "hello" }]);
  });

  it("flattens content parts on ordinary role messages too", () => {
    const out = convertResponsesInput([{ role: "user", content: [{ type: "input_text", text: "hi" }] }]);
    assert.deepEqual(out, [{ role: "user", content: "hi" }]);
  });

  it("keeps non-text-only payloads as JSON", () => {
    const out = convertResponsesInput([{ role: "user", content: [{ type: "input_image", image_url: "http://x/y.png" }] }]);
    assert.equal(out[0].content, '[{"type":"input_image","image_url":"http://x/y.png"}]');
  });

  it("keeps assistant tool calls so the history is not lost", () => {
    const out = convertResponsesInput([
      { role: "user", content: "run echo hi" },
      { type: "function_call", call_id: "call_1", name: "shell", arguments: '{"cmd":"echo hi"}' },
      { type: "function_call_output", call_id: "call_1", output: "hi" },
    ]);
    assert.equal(out.length, 3);
    assert.equal(out[1].role, "assistant");
    assert.equal(out[1].tool_calls[0].function.name, "shell");
    assert.equal(out[1].tool_calls[0].function.arguments, '{"cmd":"echo hi"}');
    assert.equal(out[2].role, "tool");
    assert.equal(out[2].tool_call_id, "call_1");
  });

  it("stringifies non-string tool call arguments", () => {
    const out = convertResponsesInput([
      { type: "function_call", call_id: "c", name: "shell", arguments: { cmd: "ls" } },
    ]);
    assert.equal(out[0].tool_calls[0].function.arguments, '{"cmd":"ls"}');
  });

  it("nests flat function tools", () => {
    const out = convertResponsesTools([
      { type: "function", name: "shell", description: "run", parameters: { type: "object" } },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "function");
    assert.equal(out[0].function.name, "shell");
  });

  it("drops non-function tool types that upstreams reject with 400", () => {
    const out = convertResponsesTools([
      { type: "custom", name: "apply_patch", format: { type: "text" } },
      { type: "local_shell" },
      { type: "web_search" },
      { type: "function", name: "shell" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].function.name, "shell");
  });

  it("gives function tools a schema when the client omits one", () => {
    const out = convertResponsesTools([{ type: "function", name: "shell" }]);
    assert.deepEqual(out[0].function.parameters, { type: "object", properties: {}, additionalProperties: true });
  });

  it("passes already-nested tools through untouched", () => {
    const nested = { type: "function", function: { name: "shell", parameters: { type: "object" } } };
    assert.deepEqual(convertResponsesTools([nested]), [nested]);
  });

  it("drops junk entries", () => {
    assert.deepEqual(convertResponsesTools([null, "nope", 5, { type: "function" }]), []);
  });
});