import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeChatMessageRoles } from "./sanitize-message-roles.js";

describe("sanitizeChatMessageRoles", () => {
  it("maps developer→system and model→assistant", () => {
    const body = {
      messages: [
        { role: "developer", content: "sys" },
        { role: "model", content: "hi" },
        { role: "user", content: "u" },
        { role: "function", content: "{}" },
      ],
    };
    const r = sanitizeChatMessageRoles(body);
    assert.equal(r.changed, true);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "assistant");
    assert.equal(body.messages[2].role, "user");
    assert.equal(body.messages[3].role, "function");
  });

  it("maps unknown role with content to user", () => {
    const body = { messages: [{ role: "human", content: "hello" }] };
    sanitizeChatMessageRoles(body);
    assert.equal(body.messages[0].role, "user");
  });

  it("leaves allowlist roles alone", () => {
    const body = {
      messages: [
        { role: "system", content: "s" },
        { role: "assistant", content: "a", tool_calls: [] },
        { role: "tool", content: "t", tool_call_id: "1" },
      ],
    };
    const r = sanitizeChatMessageRoles(body);
    assert.equal(r.changed, false);
  });
});
