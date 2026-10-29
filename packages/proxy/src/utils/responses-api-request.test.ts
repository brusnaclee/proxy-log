import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Shape-only replicas of the /v1/responses → /v1/chat/completions conversion
 * in packages/proxy/src/routes/proxy.ts. Kept in sync manually so the tool
 * handling stays testable without booting the whole route.
 */
export function responsesContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
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

/**
 * Responses API content parts → Chat Completions multi-part content.
 * `input_image` must become a real `image_url` part, otherwise the image is
 * flattened into a JSON string and the model replies "No image was provided".
 */
export function responsesContentToChatParts(content: unknown): string | any[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return responsesContentToText(content);

  const parts: any[] = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    const type = String(c.type || '');
    if (type === 'input_text' || type === 'output_text' || type === 'text' || type === 'summary_text') {
      if (typeof c.text === 'string') parts.push({ type: 'text', text: c.text });
      continue;
    }
    if (type === 'input_image' || type === 'image_url' || type === 'image') {
      const src = (c as any).image_url ?? (c as any).url ?? (c as any).image ?? null;
      const url = typeof src === 'string' ? src : src?.url ?? null;
      if (url) {
        parts.push({ type: 'image_url', image_url: { url } });
        continue;
      }
      const data = (c as any).source?.data ?? (c as any).data ?? null;
      const mediaType = (c as any).source?.media_type ?? (c as any).media_type ?? 'image/png';
      if (data) {
        parts.push({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } });
        continue;
      }
    }
  }
  if (parts.length === 0) return responsesContentToText(content);
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text).join('');
  return parts;
}

export function convertResponsesInput(input: unknown): any[] {
  const messages: any[] = [];
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input as any[]) {
      if (item.role && item.content !== undefined) {
        messages.push({
          role: item.role === 'developer' ? 'system' : item.role,
          content: responsesContentToChatParts(item.content),
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
      const fn = t.function;
      const name = String(
        fn?.name ||
          t.name ||
          (type === "local_shell"
            ? "local_shell"
            : type === "web_search"
              ? "web_search"
              : type === "computer_use_preview"
                ? "computer_use_preview"
                : ""),
      ).trim();
      if (!name) return null;
      return {
        type: "function",
        function: {
          name,
          description:
            fn?.description ??
            t.description ??
            (type === "local_shell"
              ? "Run a shell command locally in the workspace."
              : type === "web_search"
                ? "Search the web."
                : type === "custom"
                  ? `Custom tool: ${name}`
                  : undefined),
          parameters:
            fn?.parameters ??
            t.parameters ??
            (type === "local_shell"
              ? { type: "object", properties: { command: { type: "array", items: { type: "string" } } }, required: ["command"] }
              : type === "web_search"
                ? { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
                : { type: "object", properties: {}, additionalProperties: true }),
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

  it("maps input_image to a real image_url part (not a JSON string)", () => {
    const out = convertResponsesInput([
      { role: "user", content: [{ type: "input_image", image_url: "http://x/y.png" }] },
    ]);
    assert.deepEqual(out, [
      { role: "user", content: [{ type: "image_url", image_url: { url: "http://x/y.png" } }] },
    ]);
  });

  it("keeps text alongside an image as chat parts", () => {
    const out = convertResponsesInput([
      {
        role: "user",
        content: [
          { type: "input_text", text: "what is this?" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
    assert.deepEqual(out, [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ]);
  });

  it("maps an Anthropic-style base64 source inside a Responses payload", () => {
    const out = convertResponsesInput([
      {
        role: "user",
        content: [{ type: "input_image", source: { type: "base64", media_type: "image/png", data: "BBBB" } }],
      },
    ]);
    assert.deepEqual(out, [
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } }] },
    ]);
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

  it("downgrades non-function tool types instead of dropping them", () => {
    const out = convertResponsesTools([
      { type: "custom", name: "apply_patch", description: "patch", format: { type: "text" } },
      { type: "local_shell" },
      { type: "web_search" },
      { type: "function", name: "shell" },
    ]);
    assert.equal(out.length, 4);
    assert.ok(out.every((t: any) => t.type === "function"));
    const localShell = out.find((t: any) => t.function.name === "local_shell");
    assert.deepEqual(localShell.function.parameters, {
      type: "object",
      properties: { command: { type: "array", items: { type: "string" } } },
      required: ["command"],
    });
    const search = out.find((t: any) => t.function.name === "web_search");
    assert.ok(search.function.parameters.properties.query);
  });

  it("keeps a custom tool callable with a permissive schema", () => {
    const out = convertResponsesTools([{ type: "custom", name: "apply_patch", description: "patch" }]);
    assert.equal(out[0].function.name, "apply_patch");
    assert.deepEqual(out[0].function.parameters, { type: "object", properties: {}, additionalProperties: true });
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