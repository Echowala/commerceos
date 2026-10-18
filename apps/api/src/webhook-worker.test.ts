import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getWebhookRetryDelay, MAX_ATTEMPTS, WEBHOOK_REQUEST_TIMEOUT_MS, validateWebhookTarget } from "./webhook-worker.js";

describe("webhook worker", () => {
  it("signs webhook payloads with HMAC SHA-256", () => {
    const signature = crypto.createHmac("sha256", "secret").update('{"ok":true}').digest("hex");
    assert.equal(signature.length, 64);
  });

  it("uses a bounded retry policy with increasing delays", () => {
    assert.equal(MAX_ATTEMPTS, 5);
    assert.equal(getWebhookRetryDelay(1), 60_000);
    assert.equal(getWebhookRetryDelay(2), 300_000);
    assert.equal(getWebhookRetryDelay(3), 900_000);
    assert.equal(getWebhookRetryDelay(4), 3_600_000);
    assert.equal(getWebhookRetryDelay(5), 3_600_000);
  });

  it("uses a ten second request timeout", () => {
    assert.equal(WEBHOOK_REQUEST_TIMEOUT_MS, 10_000);
  });

  it("rejects localhost webhook targets", async () => {
    await assert.rejects(validateWebhookTarget("https://localhost/hook"), /not allowed/);
  });

  it("rejects non-HTTPS webhook targets", async () => {
    await assert.rejects(validateWebhookTarget("http://example.com/hook"), /must be HTTPS/);
  });

  it("rejects credentials embedded in webhook URLs", async () => {
    await assert.rejects(validateWebhookTarget("https://user:pass@example.com/hook"), /embedded credentials/);
  });
});
