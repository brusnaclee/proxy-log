import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractLatestToolSignature } from "./tool-signature.js";
import {
  applyAntiWaste,
  buildAntiWasteShortCircuitJson,
  buildAntiWasteShortCircuitSse,
  isAntiWasteEnabled,
  resolveShortCircuitAgentTool,
} from "./anti-waste.js";
import { resetAntiWasteTracker } from "./anti-waste-tracker.js";

const CLINE_TOOLS = [
  { type: "function", function: { name: "read_file" } },
  { type: "function", function: { name: "ask_followup_question" } },
  { type: "function", function: { name: "attempt_completion" } },
];

describe("extractLatestToolSignature", () => {
  it("parses Cline read_file dumps", () => {
    const sig = extractLatestToolSignature({
      messages: [
        {
          role: "user",
          content: "[read_file for 'src/a.ts'] Result: hello world ".repeat(20),
        },
      ],
    });
    assert.ok(sig);
    assert.equal(sig!.toolName, "read_file");
    assert.equal(sig!.target, "src/a.ts");
    assert.equal(sig!.noisy, true);
  });

  it("parses Cursor Called the Read tool", () => {
    const sig = extractLatestToolSignature({
      messages: [
        {
          role: "user",
          content:
            'Called the Read tool with the following input: {"filePath":"C:\\\\x\\\\a.ts"}',
        },
      ],
    });
    assert.ok(sig);
    assert.equal(sig!.toolName, "read");
    assert.ok(sig!.target?.includes("a.ts"));
  });
});

describe("resolveShortCircuitAgentTool", () => {
  it("prefers ask_followup_question", () => {
    const t = resolveShortCircuitAgentTool(CLINE_TOOLS, {
      toolName: "read_file",
      target: "a.ts",
    });
    assert.ok(t);
    assert.equal(t!.name, "ask_followup_question");
    assert.ok(String((t!.arguments as any).question).includes("read_file"));
  });

  it("returns null without safe agent tools", () => {
    assert.equal(
      resolveShortCircuitAgentTool([{ type: "function", function: { name: "read_file" } }]),
      null,
    );
  });
});

describe("applyAntiWaste", () => {
  it("dedupes and short-circuits with synthetic tool when safe agent tool present", () => {
    process.env.ANTI_WASTE_ENABLED = "1";
    const sessionKey = `test-session:${Date.now()}`;
    resetAntiWasteTracker(sessionKey);

    const bodyFactory = (n: number) => ({
      model: "test",
      tools: CLINE_TOOLS,
      messages: [
        { role: "user", content: `prompt ${n}` },
        {
          role: "user",
          content: `[read_file for 'Certifications.tsx'] Result: ${"x".repeat(5000)}`,
        },
      ],
    });

    let body = bodyFactory(1);
    let r = applyAntiWaste({
      requestBody: body,
      sessionKey,
      isNewPrompt: true,
      normalizedIde: "cline",
    });
    assert.equal(r.shortCircuit, false);

    for (let i = 2; i <= 5; i++) {
      body = bodyFactory(i);
      r = applyAntiWaste({
        requestBody: body,
        sessionKey,
        isNewPrompt: false,
        normalizedIde: "cline",
      });
    }
    assert.ok(r.deduped || r.seenCount >= 3);
    assert.equal(r.shortCircuit, true);
    assert.ok(r.shortCircuitTool);
    assert.equal(r.shortCircuitTool!.name, "ask_followup_question");
    assert.ok(r.flags.includes("short_circuited"));
    assert.ok(
      String(body.messages[body.messages.length - 1].content).includes("[cached]"),
    );
  });

  it("skips short-circuit when no safe agent tool (still dedupe/nudge)", () => {
    process.env.ANTI_WASTE_ENABLED = "1";
    const sessionKey = `test-nosafe:${Date.now()}`;
    resetAntiWasteTracker(sessionKey);

    const bodyFactory = () => ({
      model: "test",
      tools: [{ type: "function", function: { name: "read_file" } }],
      messages: [
        {
          role: "user",
          content: `[read_file for 'same.ts'] Result: ${"x".repeat(5000)}`,
        },
      ],
    });

    applyAntiWaste({
      requestBody: bodyFactory(),
      sessionKey,
      isNewPrompt: true,
      normalizedIde: "cline",
    });
    let r = applyAntiWaste({
      requestBody: bodyFactory(),
      sessionKey,
      isNewPrompt: false,
      normalizedIde: "cline",
    });
    for (let i = 0; i < 6; i++) {
      r = applyAntiWaste({
        requestBody: bodyFactory(),
        sessionKey,
        isNewPrompt: false,
        normalizedIde: "cline",
      });
    }
    assert.equal(r.shortCircuit, false);
    assert.equal(r.shortCircuitTool, null);
    assert.ok(r.flags.includes("short_circuit_skipped_no_safe_tool"));
  });

  it("respects X-Anti-Waste: off", () => {
    const headers = new Headers({ "X-Anti-Waste": "off" });
    assert.equal(isAntiWasteEnabled(headers), false);
  });

  it("builds tool_calls SSE/JSON short-circuit payloads", () => {
    const agentTool = {
      name: "ask_followup_question",
      arguments: { question: "Already have result of read_file; continue." },
    };
    const sse = buildAntiWasteShortCircuitSse({
      model: "x",
      toolName: "read_file",
      agentTool,
    });
    assert.ok(sse.includes("data: "));
    assert.ok(sse.includes("[DONE]"));
    assert.ok(sse.includes("tool_calls"));
    assert.ok(sse.includes("ask_followup_question"));
    assert.ok(!sse.includes("I will not call the same tool again"));

    const json = buildAntiWasteShortCircuitJson({
      model: "x",
      toolName: "read_file",
      agentTool,
    });
    assert.equal(json.choices[0].finish_reason, "tool_calls");
    assert.equal(json.choices[0].message.content, null);
    assert.equal(json.choices[0].message.tool_calls![0].function.name, "ask_followup_question");
  });
});

describe("IDE harness ~10 prompts", () => {
  const profiles = [
    "cline",
    "roo code",
    "continue",
    "cursor",
    "opencode",
    "claude code",
    "openclaw",
    "node.js client",
    "zed",
    "browser client",
  ];

  for (const ide of profiles) {
    it(`10 nonstop prompts with duplicate reads — ${ide}`, () => {
      process.env.ANTI_WASTE_ENABLED = "1";
      const sessionKey = `harness:${ide}:${Date.now()}`;
      resetAntiWasteTracker(sessionKey);
      let shortCircuits = 0;
      for (let p = 0; p < 10; p++) {
        applyAntiWaste({
          requestBody: {
            messages: [{ role: "user", content: `task ${p}` }],
            tools: CLINE_TOOLS,
          },
          sessionKey,
          isNewPrompt: true,
          normalizedIde: ide,
        });
        for (let h = 0; h < 6; h++) {
          const body = {
            tools: CLINE_TOOLS,
            messages: [
              {
                role: "user",
                content: `[read_file for 'same.ts'] Result: ${"data".repeat(800)}`,
              },
            ],
          };
          const r = applyAntiWaste({
            requestBody: body,
            sessionKey,
            isNewPrompt: false,
            normalizedIde: ide,
          });
          if (r.shortCircuit) shortCircuits++;
        }
      }
      assert.ok(shortCircuits >= 10, `expected short-circuits, got ${shortCircuits}`);
    });
  }
});
