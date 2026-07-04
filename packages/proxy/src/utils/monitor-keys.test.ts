import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Mirror monitorKeyCandidates logic for unit testing without DB imports.
function stripGpyPrefix(modelId: string): string {
  const lower = String(modelId || "").toLowerCase();
  if (!lower.startsWith("gpy/")) return lower;
  const parts = lower.split("/");
  return parts.slice(2).join("/");
}

function monitorKeyCandidates(modelId: string): string[] {
  const lower = String(modelId || "").toLowerCase();
  const keys = new Set<string>([lower, stripGpyPrefix(lower)]);
  if (lower.startsWith("gpy/")) {
    const rest = lower.slice(4);
    keys.add(rest);
    const slash = rest.indexOf("/");
    if (slash > 0) keys.add(rest.slice(slash + 1));
  }
  return [...keys];
}

describe("monitor key alignment", () => {
  it("matches gpy/tokito/foo against monitor rows for foo and tokito/foo", () => {
    const keys = monitorKeyCandidates("gpy/tokito/glm-5.2");
    assert.ok(keys.includes("gpy/tokito/glm-5.2"));
    assert.ok(keys.includes("tokito/glm-5.2"));
    assert.ok(keys.includes("glm-5.2"));
  });
});
