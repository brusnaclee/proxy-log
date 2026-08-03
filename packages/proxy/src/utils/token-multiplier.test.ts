import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  setTokenMultiplierRulesCache,
  resolveTokenMultipliers,
  sqlMultiplierExpr,
  applyTokenMultiplier,
} from "./token-multiplier.js";

describe("token multiplier patterns", () => {
  beforeEach(() => {
    setTokenMultiplierRulesCache([
      { pattern: "claude", input: 3 },
      { pattern: "gpt", input: 2 },
    ]);
    process.env.INPUT_TOKEN_MULTIPLIER = "1";
    process.env.OUTPUT_TOKEN_MULTIPLIER = "10";
  });

  it("resolves claude input 3x and inherits output 10x", () => {
    const m = resolveTokenMultipliers("phantom/amanai/claude-opus-4");
    assert.equal(m.input, 3);
    assert.equal(m.output, 10);
  });

  it("supports decimal multipliers (e.g. Claude 2.5)", () => {
    setTokenMultiplierRulesCache([{ pattern: "claude", input: 2.5 }]);
    const m = resolveTokenMultipliers("phantom/amanai/claude-sonnet-4.6");
    assert.equal(m.input, 2.5);
    assert.equal(m.output, 10);
    assert.match(sqlMultiplierExpr("input", "model"), /THEN 2\.5/);
    const row = applyTokenMultiplier({
      model: "claude-sonnet-4.6",
      promptTokens: 100,
      completionTokens: 10,
      tokens: 110,
    });
    assert.equal(row.promptTokens, 250);
    assert.equal(row.completionTokens, 100);
  });

  it("resolves gpt / chatgpt input 2x", () => {
    assert.equal(resolveTokenMultipliers("phantom/amanai/gpt-5.6-terra").input, 2);
    assert.equal(resolveTokenMultipliers("chatgpt-5.5").input, 2);
  });

  it("falls back to global for unmatched models", () => {
    const m = resolveTokenMultipliers("phantom/amanai/glm-5.2");
    assert.equal(m.input, 1);
    assert.equal(m.output, 10);
  });

  it("trial always 1x", () => {
    const m = resolveTokenMultipliers("claude-opus", { isTrial: true });
    assert.equal(m.input, 1);
    assert.equal(m.output, 1);
  });

  it("sql CASE prefers first match", () => {
    const expr = sqlMultiplierExpr("input", "model");
    assert.match(expr, /claude/);
    assert.match(expr, /THEN 3/);
    assert.match(expr, /THEN 2/);
    assert.match(expr, /ELSE 1/);
  });

  it("applyTokenMultiplier uses row.model", () => {
    const row = applyTokenMultiplier({
      model: "claude-sonnet-4",
      promptTokens: 100,
      completionTokens: 10,
      tokens: 110,
    });
    assert.equal(row.promptTokens, 300);
    assert.equal(row.completionTokens, 100); // 10 × global out 10
    assert.equal(row.tokens, 400);
  });
});
