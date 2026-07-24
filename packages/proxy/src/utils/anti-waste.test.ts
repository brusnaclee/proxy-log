import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractLatestToolSignature } from "./tool-signature.js";
import {
  applyAntiWaste,
  buildAntiWasteShortCircuitSse,
  isAntiWasteEnabled,
} from "./anti-waste.js";
import { resetAntiWasteTracker } from "./anti-waste-tracker.js";

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

describe("applyAntiWaste", () => {
  it("dedupes and short-circuits repeated noisy tools without header-off", () => {
    process.env.ANTI_WASTE_ENABLED = "1";
    const sessionKey = `test-session:${Date.now()}`;
    resetAntiWasteTracker(sessionKey);

    const bodyFactory = (n: number) => ({
      model: "test",
      messages: [
        { role: "user", content: `prompt ${n}` },
        {
          role: "user",
          content: `[read_file for 'Certifications.tsx'] Result: ${"x".repeat(5000)}`,
        },
      ],
    });

    // first new prompt
    let body = bodyFactory(1);
    let r = applyAntiWaste({
      requestBody: body,
      sessionKey,
      isNewPrompt: true,
      normalizedIde: "cline",
    });
    assert.equal(r.shortCircuit, false);

    // hops 2..5 same signature
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
    assert.ok(r.flags.includes("short_circuited"));
    assert.ok(
      String(body.messages[body.messages.length - 1].content).includes("[cached]"),
    );
  });

  it("respects X-Anti-Waste: off", () => {
    const headers = new Headers({ "X-Anti-Waste": "off" });
    assert.equal(isAntiWasteEnabled(headers), false);
  });

  it("builds valid SSE short-circuit payload", () => {
    const sse = buildAntiWasteShortCircuitSse({ model: "x", toolName: "read_file" });
    assert.ok(sse.includes("data: "));
    assert.ok(sse.includes("[DONE]"));
    assert.ok(sse.includes("chat.completion.chunk"));
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
        // user prompt
        applyAntiWaste({
          requestBody: {
            messages: [{ role: "user", content: `task ${p}` }],
          },
          sessionKey,
          isNewPrompt: true,
          normalizedIde: ide,
        });
        // 6 identical tool hops
        for (let h = 0; h < 6; h++) {
          const body = {
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
