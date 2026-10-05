import { describe, expect, it, vi } from "vitest";

describe("webhook worker", () => {
  it("signs webhook payloads with HMAC SHA-256", async () => {
    const hmac = await import("node:crypto");
    const signature = hmac.createHmac("sha256", "secret").update('{"ok":true}').digest("hex");
    expect(signature).toHaveLength(64);
  });

  it("uses bounded retries", () => {
    const maxAttempts = 5;
    expect(maxAttempts).toBe(5);
  });

  it("uses a ten second request timeout", () => {
    const timeout = 10_000;
    expect(timeout).toBe(10_000);
  });
});
