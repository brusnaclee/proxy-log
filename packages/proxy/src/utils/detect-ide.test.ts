import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectIde, detectIdeFromContent, normalizeIdeName, GENERIC_IDE_LABELS } from "./detect-ide.js";

describe("detectIde UA", () => {
  it("detects Zed from production UA", () => {
    assert.equal(
      detectIde("Zed/1.9.0+stable.316.ced90fc636c4ede05402befc38a63bae7fd741bd (macos; aarch64)"),
      "Zed",
    );
  });
  it("detects OpenAI Go / Bun / Pi / Tokito / Postman / OkHttp", () => {
    assert.equal(detectIde("OpenAI/Go 3.15.0"), "OpenAI Go SDK");
    assert.equal(detectIde("Bun/1.3.14"), "Bun Client");
    assert.equal(detectIde("pi/0.80.3 (linux; node/v24.11.0; x64)"), "Pi Agent");
    assert.equal(detectIde("TokitoProbe/1.0 (Windows NT 10.0; Win64; x64)"), "Tokito Probe");
    assert.equal(detectIde("TokitoCompare/1.0 (Windows NT 10.0; Win64; x64)"), "Tokito Probe");
    assert.equal(detectIde("PostmanRuntime/7.54.0"), "Postman");
    assert.equal(detectIde("okhttp/4.9.2"), "OkHttp Client");
  });
  it("detects OpenAI JS/Python and bare node", () => {
    assert.equal(detectIde("OpenAI/JS 6.26.0"), "OpenAI Node SDK");
    assert.equal(detectIde("OpenAI/Python 2.24.0"), "OpenAI Python SDK");
    assert.equal(detectIde("AsyncOpenAI/Python 2.44.0"), "OpenAI Python SDK");
    assert.equal(detectIde("node"), "Node.js Client");
  });
  it("detects ZCode UA", () => {
    assert.equal(detectIde("ZCode/unknown"), "ZCode");
  });
});

describe("detectIdeFromContent", () => {
  it("lifts OpenClaw / Ralph / Cursor from node-like bodies", () => {
    assert.equal(
      detectIdeFromContent({
        messages: [{ role: "user", content: "[OpenClaw heartbeat poll]" }],
      }),
      "OpenClaw",
    );
    assert.equal(
      detectIdeFromContent({
        messages: [
          {
            role: "user",
            content: "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.",
          },
        ],
      }),
      "OpenClaw",
    );
    assert.equal(
      detectIdeFromContent({
        messages: [
          {
            role: "system",
            content: "# Ralph Agent Instructions You are an autonomous coding agent",
          },
        ],
      }),
      "Ralph Agent",
    );
    assert.equal(
      detectIdeFromContent({
        messages: [
          {
            role: "user",
            content:
              'Called the Read tool with the following input: {"filePath":"C:\\\\Users\\\\x\\\\a.ts"}',
          },
        ],
      }),
      "Cursor",
    );
  });
  it("detects Cline duplicate-read and Roo tool_response", () => {
    assert.equal(
      detectIdeFromContent({
        messages: [
          {
            role: "user",
            content: "[read_file for 'src/a.ts'] Result: [DUPLICATE READ] You have already",
          },
        ],
      }),
      "Cline",
    );
    assert.equal(
      detectIdeFromContent({
        messages: [{ role: "user", content: "<tool_response>ok</tool_response>" }],
      }),
      "Roo Code",
    );
  });
});

describe("GENERIC_IDE_LABELS", () => {
  it("includes new generic clients for content re-detect", () => {
    for (const k of ["bun client", "openai go sdk", "okhttp client", "postman", "pi agent"]) {
      assert.ok(GENERIC_IDE_LABELS.has(k), k);
    }
    assert.equal(normalizeIdeName("Bun Client"), "bun client");
  });
});
