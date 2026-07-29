import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isKeyScopedAuthFailure } from "./upstream-key-failure.js";

describe("isKeyScopedAuthFailure", () => {
  it("rotates revoked and model/key permission failures", () => {
    assert.equal(
      isKeyScopedAuthFailure(
        403,
        '{"error":{"message":"This API key has been revoked.","code":"key_revoked"}}',
      ),
      true,
    );
    assert.equal(
      isKeyScopedAuthFailure(
        403,
        '{"error":{"message":"Combo \\"kagiro/claude-opus-4.8\\" is not allowed for this API key"}}',
      ),
      true,
    );
  });

  it("does not rotate provider/model-wide failures or other statuses", () => {
    assert.equal(
      isKeyScopedAuthFailure(403, '{"error":{"message":"HTTP 403 (reset after 30s)"}}'),
      false,
    );
    assert.equal(
      isKeyScopedAuthFailure(403, '{"error":{"message":"No active credentials for provider"}}'),
      false,
    );
    assert.equal(isKeyScopedAuthFailure(429, "API key rate limited"), false);
    assert.equal(isKeyScopedAuthFailure(401, "API key revoked"), false);
  });
});
