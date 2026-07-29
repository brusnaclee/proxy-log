import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  _resetUpstreamScrubForTests,
  scrubUpstreamLeakText,
  scrubUpstreamLeakJson,
  StreamHoldbackScrubber,
  scrubOpenAiStreamChunk,
  buildOpenAiContentFlushChunk,
} from "./upstream-leak-scrub.js";

describe("upstream-leak-scrub", () => {
  beforeEach(() => {
    _resetUpstreamScrubForTests({
      secrets: ["sk-amanai-SUPERSECRETKEY123456", "sk-ant-LEGACYKEY999"],
      hosts: ["api.amanai.dev", "amanai.dev"],
    });
  });

  it("redacts exact provider keys", () => {
    const s = scrubUpstreamLeakText(
      "use key sk-amanai-SUPERSECRETKEY123456 please",
    );
    assert.ok(!s.includes("SUPERSECRET"));
    assert.ok(!s.includes("sk-amanai-SUPERSECRETKEY123456"));
  });

  it("redacts amanai footer + url", () => {
    const s = scrubUpstreamLeakText(
      "Hello world.\nThis response was delivered by amanai.\nBase: https://api.amanai.dev/v1\nKey: sk-amanai-SUPERSECRETKEY123456",
    );
    assert.ok(!/delivered by amanai/i.test(s));
    assert.ok(!s.includes("api.amanai.dev"));
    assert.ok(!s.includes("SUPERSECRET"));
  });

  it("redacts real footer form delivered by ai.amanai.dev", () => {
    const s = scrubUpstreamLeakText(
      "Done.\n\nThis response was delivered by ai.amanai.dev",
    );
    assert.ok(!/delivered by/i.test(s));
    assert.ok(!s.includes("ai.amanai.dev"));
    assert.ok(s.includes("Done"));
  });

  it("redacts Bearer tokens and sk- patterns", () => {
    const s = scrubUpstreamLeakText(
      "Authorization: Bearer abcdefghijklmnop AND sk-or-v1-abcdefghijklmnop",
    );
    assert.ok(!s.includes("abcdefghijklmnop"));
  });

  it("scrubs nested JSON content", () => {
    const payload = {
      choices: [
        {
          message: {
            content:
              "done. This response was delivered by amanai. https://api.amanai.dev/v1 key sk-amanai-SUPERSECRETKEY123456",
          },
        },
      ],
      error: { message: "bad sk-ant-LEGACYKEY999" },
    };
    scrubUpstreamLeakJson(payload);
    assert.ok(!payload.choices[0].message.content.includes("amanai.dev"));
    assert.ok(!payload.choices[0].message.content.includes("SUPERSECRET"));
    assert.ok(!payload.error.message.includes("LEGACYKEY"));
  });

  it("preserves whitespace exactly when there is nothing sensitive", () => {
    const original =
      '  ls -la "/Users/me/Pebble Labs Pte. Ltd./backend/"  \n\n\n' +
      "    indented code\n";
    assert.equal(scrubUpstreamLeakText(original), original);
  });

  it("preserves streamed text boundaries across holdback emissions", () => {
    const hb = new StreamHoldbackScrubber(12);
    const chunks = [
      "Saya sudah",
      " memiliki informasi",
      " yang cukup.",
      "  Keep  double spaces.",
      "\n    code indent",
    ];
    const emitted = chunks.map((chunk) => hb.push(chunk)).join("") + hb.flush();
    assert.equal(emitted, chunks.join(""));
  });

  it("preserves leading spaces in streamed tool argument fragments", () => {
    const first = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '{"command":"ls' } },
            ],
          },
        },
      ],
    };
    const second = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: ' backend/"}' } },
            ],
          },
        },
      ],
    };
    scrubOpenAiStreamChunk(first, null);
    scrubOpenAiStreamChunk(second, null);
    assert.equal(
      first.choices[0].delta.tool_calls[0].function.arguments +
        second.choices[0].delta.tool_calls[0].function.arguments,
      '{"command":"ls backend/"}',
    );
  });

  it("holdback catches footer split across chunks", () => {
    const hb = new StreamHoldbackScrubber(80);
    const part1 = "Normal answer text continues here. This response was deliv";
    const part2 = "ered by amanai.\nhttps://api.amanai.dev/v1\nsk-amanai-SUPERSECRETKEY123456";
    const a = hb.push(part1);
    const b = hb.push(part2);
    const c = hb.flush();
    const all = a + b + c;
    assert.ok(!/delivered by amanai/i.test(all));
    assert.ok(!all.includes("SUPERSECRET"));
    assert.ok(!all.includes("api.amanai.dev"));
    assert.ok(all.includes("Normal answer"));
  });

  it("openai stream chunk holdback + flush chunk", () => {
    const hb = new StreamHoldbackScrubber(80);
    const chunk1 = {
      id: "chatcmpl-1",
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { content: "Hi. This response was delivered by ama" }, finish_reason: null }],
    };
    scrubOpenAiStreamChunk(chunk1, hb);
    const chunk2 = {
      id: "chatcmpl-1",
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { content: "nai. sk-amanai-SUPERSECRETKEY123456" }, finish_reason: null }],
    };
    scrubOpenAiStreamChunk(chunk2, hb);
    const flushed = hb.flush();
    const line = buildOpenAiContentFlushChunk(chunk2, flushed);
    assert.ok(line);
    assert.ok(!line!.includes("SUPERSECRET"));
    assert.ok(!/delivered by amanai/i.test(line!));
  });

  it("does not throw on empty / non-string", () => {
    assert.equal(scrubUpstreamLeakText(""), "");
    assert.equal(scrubUpstreamLeakText(null), "");
    assert.deepEqual(scrubUpstreamLeakJson(null), null);
    assert.deepEqual(scrubUpstreamLeakJson({ a: 1 }), { a: 1 });
  });
});
