import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { queueWebhookEvent } from "./webhook-events.js";

type Endpoint = { id: string; events: unknown };

const makeDb = (endpoints: Endpoint[]) => {
  const queries: unknown[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  return {
    queries,
    upserts,
    db: {
      webhookEndpoint: {
        findMany: async (args: unknown) => {
          queries.push(args);
          return endpoints;
        },
      },
      webhookDelivery: {
        upsert: async (args: Record<string, unknown>) => {
          upserts.push(args);
          return { id: "delivery" };
        },
      },
    } as never,
  };
};

describe("webhook event queueing", () => {
  const event = {
    tenantId: "tenant-a",
    eventId: "event-123",
    eventType: "ORDER_PLACED",
    payload: { orderId: "order-456", total: 2500 },
  };

  it("only queues deliveries for active tenant endpoints subscribed to the event", async () => {
    const { db, queries, upserts } = makeDb([
      { id: "specific-match", events: ["ORDER_PLACED"] },
      { id: "wildcard-match", events: ["*"] },
      { id: "different-event", events: ["ORDER_STATUS_CHANGED"] },
      { id: "malformed-events", events: { subscribed: "ORDER_PLACED" } },
    ]);

    await queueWebhookEvent(event, db);

    assert.deepEqual(queries, [{
      where: { tenantId: "tenant-a", status: "ACTIVE" },
      select: { id: true, events: true },
    }]);
    assert.deepEqual(upserts.map(item => (item.where as { endpointId_eventId: { endpointId: string; eventId: string } }).endpointId_eventId.endpointId).sort(), [
      "specific-match",
      "wildcard-match",
    ]);
    assert.equal(upserts.length, 2);
    assert.equal(upserts.every(item => (item.create as Record<string, unknown>).tenantId === "tenant-a"), true);
  });

  it("uses endpointId plus eventId as the idempotency key and leaves existing delivery unchanged", async () => {
    const { db, upserts } = makeDb([{ id: "endpoint-1", events: ["ORDER_PLACED"] }]);

    await queueWebhookEvent(event, db);
    await queueWebhookEvent(event, db);

    assert.equal(upserts.length, 2);
    for (const upsert of upserts) {
      assert.deepEqual(upsert.where, {
        endpointId_eventId: { endpointId: "endpoint-1", eventId: "event-123" },
      });
      assert.deepEqual(upsert.update, {});
      assert.deepEqual(upsert.create, {
        tenantId: "tenant-a",
        endpointId: "endpoint-1",
        eventId: "event-123",
        eventType: "ORDER_PLACED",
        payload: { orderId: "order-456", total: 2500 },
      });
    }
  });

  it("does not queue deliveries when no endpoint subscribes", async () => {
    const { db, upserts } = makeDb([
      { id: "endpoint-1", events: [] },
      { id: "endpoint-2", events: null },
    ]);

    await queueWebhookEvent(event, db);

    assert.equal(upserts.length, 0);
  });
});
