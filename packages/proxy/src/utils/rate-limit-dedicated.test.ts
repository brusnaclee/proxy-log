import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findDedicatedRuleForModel,
  modelMatchesDedicatedRule,
  type DedicatedQuotaRule,
} from "./rate-limit.js";

describe("dedicated quota matching", () => {
  const rules: DedicatedQuotaRule[] = [
    {
      id: 1,
      model: "grok-4.5",
      isPattern: true,
      scope: "global",
      scopeId: 0,
      dailyTokenLimit: 5_000_000,
      monthlyTokenLimit: 0,
    },
    {
      id: 2,
      model: "grok-4.5",
      isPattern: true,
      scope: "key",
      scopeId: 9,
      dailyTokenLimit: 1_000_000,
      monthlyTokenLimit: 0,
    },
  ];

  it("matches substring pattern", () => {
    assert.equal(modelMatchesDedicatedRule("xai/grok-4.5-fast", rules[0]), true);
    assert.equal(modelMatchesDedicatedRule("claude-opus", rules[0]), false);
  });

  it("prefers key pattern over global", () => {
    const picked = findDedicatedRuleForModel(rules, "grok-4.5-beta");
    assert.ok(picked);
    assert.equal(picked!.scope, "key");
    assert.equal(picked!.dailyTokenLimit, 1_000_000);
  });
});
