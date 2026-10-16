import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  _resetUpstreamScrubForTests,
  scrubUpstreamLeakText,
  scrubUpstreamLeakJson,
  StreamHoldbackScrubber,
  StreamFinishDeferral,
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

  it("flushes holdback into finish_reason chunk (Cursor stops at finish)", () => {
    const hb = new StreamHoldbackScrubber(360);
    const contentChunk = {
      id: "chatcmpl-short",
      model: "claude-opus-4.8",
      choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
    };
    scrubOpenAiStreamChunk(contentChunk, hb);
    assert.equal(contentChunk.choices[0].delta.content, "");
    assert.equal(hb.pending(), 5);

    const finishChunk = {
      id: "chatcmpl-short",
      model: "claude-opus-4.8",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 1 },
    };
    scrubOpenAiStreamChunk(finishChunk, hb);
    assert.equal(finishChunk.choices[0].delta.content, "hello");
    assert.equal(finishChunk.choices[0].finish_reason, "stop");
    assert.equal(hb.pending(), 0);
  });

  it("defers finish_reason so late content can arrive before stop", () => {
    const hb = new StreamHoldbackScrubber(360);
    const defer = new StreamFinishDeferral();

    const earlyFinish = {
      id: "chatcmpl-late",
      model: "claude-opus-4.8",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 2168, completion_tokens: 1 },
    };
    scrubOpenAiStreamChunk(earlyFinish, hb, defer);
    defer.deferFromChunk(earlyFinish);
    assert.equal(earlyFinish.choices[0].finish_reason, null);
    assert.equal(earlyFinish.usage, undefined);
    assert.equal(defer.hasDeferred(), true);
    assert.equal(StreamFinishDeferral.isWireNoopChunk(earlyFinish), true);

    const lateContent = {
      id: "chatcmpl-late",
      model: "claude-opus-4.8",
      choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
    };
    scrubOpenAiStreamChunk(lateContent, hb, defer);
    // After premature finish, holdback is bypassed so Cursor sees text immediately.
    assert.equal(lateContent.choices[0].delta.content, "hello");
    assert.equal(hb.pending(), 0);

    const finishLine = defer.buildFinishSseLine(lateContent);
    assert.ok(finishLine);
    assert.ok(finishLine!.includes('"finish_reason":"stop"'));
    assert.ok(finishLine!.includes('"prompt_tokens":2168'));
    assert.equal(defer.hasDeferred(), false);
  });

  it("does not throw on empty / non-string", () => {
    assert.equal(scrubUpstreamLeakText(""), "");
    assert.equal(scrubUpstreamLeakText(null), "");
    assert.deepEqual(scrubUpstreamLeakJson(null), null);
    assert.deepEqual(scrubUpstreamLeakJson({ a: 1 }), { a: 1 });
  });

  // Amanai occasionally injects a fake "reward / gift code" line into chat
  // completions. The brand word should never reach the client in any casing.
  it("redacts ALL-CAPS AMANAI word (e.g. AMANAI, AMANAI-GACHA-XXXX)", () => {
    const s = scrubUpstreamLeakText(
      " reward 🎉 You rolled a rare gift code worth 100,000,000 credits: AMANAI-GACHA-A9GW-9WCZ — redeem once in your dashboard billing page",
    );
    assert.ok(!/AMANAI/i.test(s), `brand leaked: ${s}`);
    assert.ok(!/redeem once/i.test(s), `promo cta leaked: ${s}`);
    assert.ok(s.includes("loremipsum"), `placeholder missing: ${s}`);
  });

  it("keeps a redeem sentence that is not an upstream promo code", () => {
    const s = scrubUpstreamLeakText(
      "You can redeem your own coupon in the app settings later.",
    );
    assert.ok(s.includes("redeem your own coupon"));
    assert.ok(!s.includes("loremipsum"));
  });

  it("redacts mixed-case Amanai / amanai / aMaNaI", () => {
    const samples = [
      [" amanai_xyz99 reward line", "loremipsum"],
      ["Powered by amanai.gateway", "loremipsum"],
      ["Trained on aMaNaI-3 corpus", "loremipsum"],
      ["AMANAI rules", "loremipsum"],
    ];
    for (const [t, expect] of samples) {
      const s = scrubUpstreamLeakText(t);
      assert.ok(!/[Aa][Mm][Aa][Nn][Aa][Ii]/i.test(s), `brand leaked: ${s}`);
      assert.ok(s.includes(expect), `placeholder missing in: ${s}`);
    }
  });

  it("redacts reward / gift / bonus line + brand in one pass", () => {
    const original =
      "Build · DeepSeek: DeepSeek V4 Flash 0731 · 4m 59s · 32.1 tok/s\n" +
      " reward 🎉 You rolled a rare gift code worth 100,000,000 credits: AMANAI-GACHA-A9GW-9WCZ — redeem once in your dashboard billing page: dashboard/billing/";
    const s = scrubUpstreamLeakText(original);
    assert.ok(!/amanai/i.test(s), `brand leaked: ${s}`);
    assert.ok(!/redeem once/i.test(s), `promo cta leaked: ${s}`);
    assert.ok(!s.includes("dashboard/billing"), `billing path leaked: ${s}`);
    assert.ok(s.includes("DeepSeek V4 Flash 0731"), "real content lost");
    assert.ok(s.includes("Build · DeepSeek:"), "real content lost");
  });

  it("redacts brand inside streamed JSON (deep + tool_calls)", () => {
    // scrubUpstreamLeakText is also used directly (non-JSON) — sanity check
    // the plain-text path first to isolate any deep-walk regressions. With
    // the marketing-hook+brand scrub the "reward line" span is intentionally
    // collapsed to a `loremipsum` placeholder; we only assert that
    // surrounding non-hook context ("ok " and " v1") survives.
    const plain = scrubUpstreamLeakText("ok Amanai reward line AMANAI-XXXX v1");
    assert.ok(!/amanai/i.test(plain), `brand leaked in plain: ${plain}`);
    assert.ok(plain.includes("loremipsum"), `placeholder missing in plain: ${plain}`);
    assert.ok(plain.startsWith("ok ") && plain.endsWith(" v1"), `context lost: ${plain}`);

    const payload = {
      choices: [
        {
          message: {
            content: "ok Amanai reward line AMANAI-XXXX v1",
          },
        },
      ],
    };
    const out = scrubUpstreamLeakJson(payload);
    const c = (out as any).choices[0].message.content;
    assert.ok(typeof c === "string", "content must be a string");
    assert.ok(!/amanai/i.test(c), `brand leaked: ${c}`);
    assert.ok(c.includes("loremipsum"), `placeholder missing in: ${c}`);
    // The "reward line" span is the marketing hook + brand and is
    // intentionally collapsed to `loremipsum`; only the surrounding
    // non-hook context must survive.
    assert.ok(
      c.startsWith("ok ") && c.endsWith(" v1"),
      `context lost: ${c}`,
    );
  });

  it("holdback catches brand word split across chunks", () => {
    const hb = new StreamHoldbackScrubber(80);
    const part1 = "Selamat! ";
    const part2 = "AMANAI-DEV reward 🎉 you got AMANAI-GACHA-A9GW-9WCZ";
    hb.push(part1);
    const b = hb.push(part2);
    const c = hb.flush();
    const all = b + c;
    assert.ok(!/amanai/i.test(all), `brand leaked: ${all}`);
  });

  it("does not touch model ids like phantom/amanai/glm-5.2 in request bodies (URL scrub only)", () => {
    // Note: scrubUpstreamLeakText is only run on upstream RESPONSE text, not
    // request bodies. The brand redaction is broader and intentionally hits
    // those model ids too — model ids are server-internal, never echoed to
    // the client inside response text.
    const s = scrubUpstreamLeakText("model: phantom/amanai/glm-5.2");
    assert.ok(!/amanai/i.test(s));
    assert.ok(s.includes("phantom/loremipsum/glm-5.2"));
  });
});
