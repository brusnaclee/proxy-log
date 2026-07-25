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
      model: "tokito/gcli/grok-4.5",
      isPattern: true,
      scope: "global",
      scopeId: 0,
      dailyTokenLimit: 5_000_000,
      monthlyTokenLimit: 0,
      dailyInputTokenLimit: 0,
      dailyOutputTokenLimit: 0,
    },
  ];

  it("matches only gcli-prefixed grok via raw model", () => {
    assert.equal(
      modelMatchesDedicatedRule("grok-4.5", rules[0], ["tokito/gcli/grok-4.5"]),
      true,
    );
    assert.equal(
      modelMatchesDedicatedRule("grok-4.5", rules[0], ["xai/grok-4.5"]),
      false,
    );
    // Without raw matchModels, normalized alone must not match slash pattern
    assert.equal(modelMatchesDedicatedRule("grok-4.5", rules[0]), false);
  });

  it("findDedicatedRuleForModel uses matchModels", () => {
    const picked = findDedicatedRuleForModel(rules, "grok-4.5", [
      "tokito/gcli/grok-4.5",
    ]);
    assert.ok(picked);
    assert.equal(picked!.dailyTokenLimit, 5_000_000);
    assert.equal(
      findDedicatedRuleForModel(rules, "grok-4.5", ["amanai/grok-4.5"]),
      null,
    );
  });
});
