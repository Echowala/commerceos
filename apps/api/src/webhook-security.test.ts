import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deliverWebhook } from "./webhook-worker.js";
import type { WebhookWorkerDependencies } from "./webhook-worker.js";

const now = new Date("2026-10-23T06:00:00.000Z");
const payload = { orderId: "order-42", total: 2500, nested: { currency: "PKR" } };
const secret = "integration-test-secret";

const makeDependencies = (capture: (url: string, init: RequestInit) => void): WebhookWorkerDependencies => ({
  db: {
    webhookDelivery: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({
        id: "delivery-42",
        tenantId: "tenant-a",
        endpointId: "endpoint-a",
        eventId: "event-42",
        eventType: "ORDER_PLACED",
        payload,
        status: "DELIVERING",
        attempts: 1,
        availableAt: now,
        deliveredAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        endpoint: { id: "endpoint-a", url: "https://receiver.example.test/hooks", secret, status: "ACTIVE" },
      }),
      update: async ({ data }: { data: unknown }) => data,
    },
    webhookDeliveryAttempt: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "attempt-42", ...data }),
      update: async ({ data }: { data: unknown }) => data,
      updateMany: async () => ({ count: 1 }),
    },
  } as never,
  validateTarget: async url => url,
  now: () => new Date(now),
  fetchImpl: async (url, init) => {
    capture(String(url), init ?? {});
    return new Response(null, { status: 204 });
  },
});

describe("webhook security integration", () => {
  it("sends a signature that verifies against the exact transmitted JSON bytes", async () => {
    let requestUrl = "";
    let requestInit: RequestInit = {};
    await deliverWebhook("delivery-42", makeDependencies((url, init) => {
      requestUrl = url;
      requestInit = init;
    }));

    const headers = new Headers(requestInit.headers);
    const body = String(requestInit.body);
    const supplied = headers.get("x-commerceos-signature");
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    assert.equal(requestUrl, "https://receiver.example.test/hooks");
    assert.equal(requestInit.method, "POST");
    assert.equal(headers.get("x-commerceos-event"), "ORDER_PLACED");
    assert.equal(headers.get("x-commerceos-event-id"), "event-42");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(body, JSON.stringify(payload));
    assert.equal(supplied, expected);

    const actualDigest = Buffer.from(String(supplied).slice("sha256=".length), "hex");
    const expectedDigest = Buffer.from(expected.slice("sha256=".length), "hex");
    assert.equal(actualDigest.length, expectedDigest.length);
    assert.equal(timingSafeEqual(actualDigest, expectedDigest), true);
    const tamperedDigest = createHmac("sha256", secret).update(body + " ").digest();
    assert.equal(timingSafeEqual(actualDigest, tamperedDigest), false);
  });

  it("does not send when the atomic delivery claim is lost", async () => {
    let sends = 0;
    const deps = makeDependencies(() => { sends += 1; });
    (deps.db as unknown as { webhookDelivery: { updateMany: () => Promise<{ count: number }> } }).webhookDelivery.updateMany = async () => ({ count: 0 });

    const result = await deliverWebhook("delivery-42", deps);

    assert.equal(result, null);
    assert.equal(sends, 0);
  });
});
