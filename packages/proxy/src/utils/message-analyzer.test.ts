import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeRequestMessages } from "./message-analyzer.js";

describe("message-analyzer Cline metadata", () => {
  it("counts real user prompt that appends environment_details", () => {
    const analysis = analyzeRequestMessages({
      messages: [
        {
          role: "user",
          content:
            "Please fix the login bug in auth.ts\n\n<environment_details>\n# VSCode Visible Files\nauth.ts\n</environment_details>",
        },
      ],
    });
    assert.equal(analysis.hasUserMessage, true);
    assert.equal(analysis.turnKind, "user_prompt");
  });

  it("treats primarily-metadata environment_details as tool follow-up", () => {
    const analysis = analyzeRequestMessages({
      messages: [
        {
          role: "user",
          content:
            "<environment_details>\n# VSCode Visible Files\nauth.ts\n# Recently Viewed\n</environment_details>",
        },
      ],
    });
    assert.equal(analysis.hasUserMessage, false);
    assert.equal(analysis.turnKind, "tool_followup");
  });

  it("treats bare continue as tool follow-up", () => {
    const analysis = analyzeRequestMessages({
      messages: [{ role: "user", content: "continue" }],
    });
    assert.equal(analysis.hasUserMessage, false);
    assert.equal(analysis.turnKind, "tool_followup");
  });

  it("does not treat continue with real instruction as metadata-only", () => {
    const analysis = analyzeRequestMessages({
      messages: [
        {
          role: "user",
          content: "continue implementing the rate limit gate for API calls",
        },
      ],
    });
    assert.equal(analysis.hasUserMessage, true);
    assert.equal(analysis.turnKind, "user_prompt");
  });
});
