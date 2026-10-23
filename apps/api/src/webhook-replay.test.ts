import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isWebhookReplayRateLimited,
  WEBHOOK_REPLAY_LIMIT,
  WEBHOOK_REPLAY_WINDOW_MS,
} from "./webhook-replay.js";

describe("webhook replay rate limit", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");

  it("counts only this tenant, endpoint, original event replay IDs, and the rolling ten-minute window", async () => {
    let query: unknown;
    const limited = await isWebhookReplayRateLimited({
      db: {
        webhookDelivery: {
          count: async args => {
            query = args;
            return 4;
          },
        },
      },
      tenantId: "tenant-a",
      endpointId: "endpoint-a",
      originalEventId: "event-42",
      now,
    });

    assert.equal(limited, false);
    assert.deepEqual(query, {
      where: {
        tenantId: "tenant-a",
        endpointId: "endpoint-a",
        eventId: { startsWith: "event-42:replay:" },
        createdAt: { gte: new Date(now.getTime() - WEBHOOK_REPLAY_WINDOW_MS) },
      },
    });
  });

  it("blocks at five replays and remains blocked above the limit", async () => {
    for (const count of [WEBHOOK_REPLAY_LIMIT, WEBHOOK_REPLAY_LIMIT + 1]) {
      const limited = await isWebhookReplayRateLimited({
        db: { webhookDelivery: { count: async () => count } },
        tenantId: "tenant-a",
        endpointId: "endpoint-a",
        originalEventId: "event-42",
        now,
      });
      assert.equal(limited, true);
    }
  });

  it("allows replay below the limit", async () => {
    const limited = await isWebhookReplayRateLimited({
      db: { webhookDelivery: { count: async () => 0 } },
      tenantId: "tenant-a",
      endpointId: "endpoint-a",
      originalEventId: "event-42",
      now,
    });
    assert.equal(limited, false);
  });
});
