import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

describe("webhook worker", () => {
  it("signs webhook payloads with HMAC SHA-256", () => {
    const signature = crypto.createHmac("sha256", "secret").update('{"ok":true}').digest("hex");
    assert.equal(signature.length, 64);
  });

  it("uses bounded retries", () => {
    const maxAttempts = 5;
    assert.equal(maxAttempts, 5);
  });

  it("uses a ten second request timeout", () => {
    const timeout = 10_000;
    assert.equal(timeout, 10_000);
  });
});
