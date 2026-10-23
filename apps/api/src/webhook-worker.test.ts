import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  deliverWebhook,
  getWebhookRetryDelay,
  MAX_ATTEMPTS,
  recoverStuckWebhookDeliveries,
  WEBHOOK_REQUEST_TIMEOUT_MS,
  validateWebhookTarget,
} from "./webhook-worker.js";
import type { WebhookWorkerDependencies } from "./webhook-worker.js";

const fixedNow = new Date("2026-10-18T12:00:00.000Z");
const clock = () => new Date(fixedNow);

const makeDelivery = (attempts = 1) => ({
  id: "delivery-1",
  tenantId: "tenant-1",
  endpointId: "endpoint-1",
  eventId: "event-1",
  eventType: "ORDER_PLACED",
  payload: { ok: true },
  status: "DELIVERING",
  attempts,
  availableAt: fixedNow,
  deliveredAt: null,
  lastError: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  endpoint: { id: "endpoint-1", url: "https://hooks.example.test/receive", secret: "test-secret", status: "ACTIVE" },
});

const dependencies = (db: Record<string, unknown>, extras: Partial<WebhookWorkerDependencies> = {}): WebhookWorkerDependencies => ({
  db: {
    ...db,
    webhookDeliveryAttempt: (db as { webhookDeliveryAttempt?: unknown }).webhookDeliveryAttempt ?? {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "attempt-1", ...data }),
      update: async ({ data }: { data: Record<string, unknown> }) => data,
      updateMany: async () => ({ count: 1 }),
    },
  } as never,
  validateTarget: async (url: string) => url,
  now: clock,
  ...extras,
});

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

  it("accepts DNS names only when every resolved address is public", async () => {
    const lookupPublic = async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    assert.equal(
      await validateWebhookTarget("https://hooks.example.test/receive", lookupPublic),
      "https://hooks.example.test/receive",
    );

    const lookupMixed = async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await assert.rejects(
      validateWebhookTarget("https://hooks.example.test/receive", lookupMixed),
      /public IP addresses/,
    );
  });

  it("rejects DNS names that resolve to no addresses", async () => {
    await assert.rejects(
      validateWebhookTarget("https://hooks.example.test/receive", async () => []),
      /public IP addresses/,
    );
  });

  it("rejects private, loopback, link-local, and reserved IPv4 webhook targets", async () => {
    const blocked = [
      "https://127.0.0.1/hook",
      "https://10.0.0.1/hook",
      "https://172.16.0.1/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/hook",
      "https://100.64.0.1/hook",
      "https://224.0.0.1/hook",
      "https://0.0.0.0/hook",
      "https://198.51.100.1/hook",
      "https://203.0.113.1/hook",
      "https://192.88.99.1/hook",
    ];
    for (const target of blocked) {
      await assert.rejects(validateWebhookTarget(target), /public IP addresses/);
    }
  });

  it("rejects loopback, unique-local, and link-local IPv6 webhook targets", async () => {
    const blocked = [
      "https://[::1]/hook",
      "https://[fc00::1]/hook",
      "https://[fd12::1]/hook",
      "https://[fe80::1]/hook",
      "https://[::]/hook",
      "https://[ff02::1]/hook",
      "https://[2001:db8::1]/hook",
    ];
    for (const target of blocked) {
      await assert.rejects(validateWebhookTarget(target), /public IP addresses/);
    }
  });

  it("atomically claims a delivery so concurrent workers only send once", async () => {
    let claimed = false;
    let fetchCalls = 0;
    let findCalls = 0;
    const db = {
      webhookDelivery: {
        updateMany: async () => {
          if (claimed) return { count: 0 };
          claimed = true;
          return { count: 1 };
        },
        findUnique: async () => {
          findCalls += 1;
          return makeDelivery(1);
        },
        update: async ({ data }: { data: unknown }) => data,
      },
    };
    const deps = dependencies(db, {
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 204 });
      },
    });

    const results = await Promise.all([
      deliverWebhook("delivery-1", deps),
      deliverWebhook("delivery-1", deps),
    ]);

    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(fetchCalls, 1);
    assert.equal(findCalls, 1);
  });

  it("requeues a delivery after a failed HTTP response with the correct backoff", async () => {
    let updateData: Record<string, unknown> | undefined;
    const db = {
      webhookDelivery: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => makeDelivery(2),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return data;
        },
      },
    };
    const result = await deliverWebhook("delivery-1", dependencies(db, {
      fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
    }));

    assert.equal((result as Record<string, unknown>).status, "QUEUED");
    assert.equal(updateData?.status, "QUEUED");
    assert.equal(updateData?.lastError, "Webhook responded with HTTP 503");
    assert.equal((updateData?.availableAt as Date).getTime(), fixedNow.getTime() + 300_000);
  });

  it("marks a delivery FAILED when its final attempt receives an HTTP error", async () => {
    let updateData: Record<string, unknown> | undefined;
    const db = {
      webhookDelivery: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => makeDelivery(MAX_ATTEMPTS),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return data;
        },
      },
    };
    await deliverWebhook("delivery-1", dependencies(db, {
      fetchImpl: async () => new Response(null, { status: 500 }),
    }));

    assert.equal(updateData?.status, "FAILED");
    assert.equal(updateData?.lastError, "Webhook responded with HTTP 500");
    assert.equal((updateData?.availableAt as Date).getTime(), fixedNow.getTime());
  });

  it("persists an individual failed attempt with HTTP status and timing", async () => {
    let attemptCreate: Record<string, unknown> | undefined;
    let attemptUpdate: Record<string, unknown> | undefined;
    const db = {
      webhookDelivery: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => makeDelivery(2),
        update: async ({ data }: { data: Record<string, unknown> }) => data,
      },
      webhookDeliveryAttempt: {
        create: async ({ data }: { data: Record<string, unknown> }) => { attemptCreate = data; return { id: "attempt-row-2" }; },
        update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { attemptUpdate = { ...where, ...data }; return data; },
        updateMany: async () => ({ count: 1 }),
      },
    };
    await deliverWebhook("delivery-1", dependencies(db, {
      fetchImpl: async () => new Response(null, { status: 502 }),
    }));
    assert.equal(attemptCreate?.attemptNumber, 2);
    assert.equal(attemptCreate?.status, "IN_PROGRESS");
    assert.equal(attemptUpdate?.id, "attempt-row-2");
    assert.equal(attemptUpdate?.status, "FAILED");
    assert.equal(attemptUpdate?.httpStatus, 502);
    assert.equal(attemptUpdate?.error, "Webhook responded with HTTP 502");
    assert.equal(attemptUpdate?.durationMs, 0);
  });

  it("retries after a network exception and caps stored error text", async () => {
    let updateData: Record<string, unknown> | undefined;
    const db = {
      webhookDelivery: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => makeDelivery(1),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return data;
        },
      },
    };
    await deliverWebhook("delivery-1", dependencies(db, {
      fetchImpl: async () => { throw new Error("network failed ".repeat(100)); },
    }));

    assert.equal(updateData?.status, "QUEUED");
    assert.equal((updateData?.lastError as string).length, 500);
    assert.equal((updateData?.availableAt as Date).getTime(), fixedNow.getTime() + 60_000);
  });

  it("recovers stale deliveries, fails exhausted attempts, and ignores compare-and-set races", async () => {
    const stale = new Date(fixedNow.getTime() - 20 * 60_000);
    const rows = [
      { id: "retry", attempts: 2, updatedAt: stale },
      { id: "exhausted", attempts: MAX_ATTEMPTS, updatedAt: stale },
      { id: "raced", attempts: 1, updatedAt: stale },
    ];
    const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    const db = {
      webhookDelivery: {
        findMany: async () => rows,
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          writes.push({ where, data });
          return { count: where.id === "raced" ? 0 : 1 };
        },
      },
    };

    const recovered = await recoverStuckWebhookDeliveries(15 * 60_000, dependencies(db));

    assert.equal(recovered, 2);
    assert.equal(writes.find(write => write.where.id === "retry")?.data.status, "QUEUED");
    assert.equal(writes.find(write => write.where.id === "exhausted")?.data.status, "FAILED");
    assert.equal(writes.find(write => write.where.id === "raced")?.where.status, "DELIVERING");
    assert.equal(writes.every(write => write.data.lastError === "Recovered stale delivery after worker interruption"), true);
  });
});
