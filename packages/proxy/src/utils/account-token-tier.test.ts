import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountTokenTierOpts, isTrialOnlyKeySet } from "./account-token-tier.js";

describe("isTrialOnlyKeySet", () => {
  it("treats an account with any non-trial key as member", () => {
    assert.equal(
      isTrialOnlyKeySet([{ isTrial: true }, { isTrial: false }]),
      false,
    );
  });

  it("keeps member tier when the only member key is inactive", () => {
    // Lapsed membership: recap/portal/admin must not silently drop to 1x.
    assert.equal(isTrialOnlyKeySet([{ isTrial: false }]), false);
  });

  it("is trial-only when every key is a trial key", () => {
    assert.equal(isTrialOnlyKeySet([{ isTrial: true }, { isTrial: true }]), true);
  });

  it("treats an empty key set as trial", () => {
    assert.equal(isTrialOnlyKeySet([]), true);
  });

  it("maps tier to multiplier opts", () => {
    assert.deepEqual(accountTokenTierOpts(true), { isTrial: true });
    assert.equal(accountTokenTierOpts(false), undefined);
  });
});
