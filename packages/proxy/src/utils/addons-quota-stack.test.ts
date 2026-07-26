import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAddonQuotaStack } from "./addons.js";

const G_IN = 2_000_000;
const G_OUT = 5_000_000;
const PACK = 10_000_000;

describe("resolveAddonQuotaStack (PM rules)", () => {
  it("Phantom only: hard I/O from global, daily unlimited", () => {
    const s = resolveAddonQuotaStack({
      hasActiveAddon: false,
      roleLimitMode: "follow_global",
      globalDailyInput: G_IN,
      globalDailyOutput: G_OUT,
      addonDailyBonus: 0,
    });
    assert.equal(s.dailyInputLimit, G_IN);
    assert.equal(s.dailyOutputLimit, G_OUT);
    assert.equal(s.effectiveDaily, 0);
    assert.equal(s.bypassIo, false);
  });

  it("Phantom + pack: In = global+pack, Out = global, daily unlimited", () => {
    const s = resolveAddonQuotaStack({
      hasActiveAddon: true,
      roleLimitMode: "follow_global",
      globalDailyInput: G_IN,
      globalDailyOutput: G_OUT,
      addonDailyBonus: PACK,
    });
    assert.equal(s.dailyInputLimit, G_IN + PACK);
    assert.equal(s.dailyOutputLimit, G_OUT);
    assert.equal(s.inputBase, G_IN);
    assert.equal(s.addonBonus, PACK);
    assert.equal(s.effectiveDaily, 0);
    assert.equal(s.bypassIo, false);
    assert.equal(s.bypassPerModelPrompts, true);
  });

  it("Premium + pack: In = pack only, Out = global, daily unlimited", () => {
    const s = resolveAddonQuotaStack({
      hasActiveAddon: true,
      roleLimitMode: "zero_unless_addon",
      globalDailyInput: G_IN,
      globalDailyOutput: G_OUT,
      addonDailyBonus: PACK,
    });
    assert.equal(s.dailyInputLimit, PACK);
    assert.equal(s.dailyOutputLimit, G_OUT);
    assert.equal(s.inputBase, 0);
    assert.equal(s.effectiveDaily, 0);
  });

  it("custom key In wins over global; pack stacks on custom", () => {
    const s = resolveAddonQuotaStack({
      hasActiveAddon: true,
      roleLimitMode: "follow_global",
      keyDailyInput: 4_000_000,
      globalDailyInput: G_IN,
      globalDailyOutput: G_OUT,
      addonDailyBonus: PACK,
    });
    assert.equal(s.dailyInputLimit, 4_000_000 + PACK);
    assert.equal(s.inputBase, 4_000_000);
  });

  it("custom daily is the only daily hard cap", () => {
    const s = resolveAddonQuotaStack({
      hasActiveAddon: true,
      roleLimitMode: "follow_global",
      keyDailyTotal: 20_000_000,
      globalDailyInput: G_IN,
      globalDailyOutput: G_OUT,
      addonDailyBonus: PACK,
    });
    assert.equal(s.effectiveDaily, 20_000_000);
    assert.equal(s.dailyInputLimit, G_IN + PACK);
  });

  it("Premium/Pro custom Out with pack", () => {
    const s = resolveAddonQuotaStack({
      hasActiveAddon: true,
      roleLimitMode: "zero_unless_addon",
      keyDailyOutput: 8_000_000,
      globalDailyInput: G_IN,
      globalDailyOutput: G_OUT,
      addonDailyBonus: PACK,
    });
    assert.equal(s.dailyInputLimit, PACK);
    assert.equal(s.dailyOutputLimit, 8_000_000);
  });
});
