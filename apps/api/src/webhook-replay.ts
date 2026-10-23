type ReplayRateLimitDb = {
  webhookDelivery: {
    count(args: {
      where: {
        tenantId: string;
        endpointId: string;
        eventId: { startsWith: string };
        createdAt: { gte: Date };
      };
    }): Promise<number>;
  };
};

export const WEBHOOK_REPLAY_LIMIT = 5;
export const WEBHOOK_REPLAY_WINDOW_MS = 10 * 60 * 1000;

export const isWebhookReplayRateLimited = async ({
  db,
  tenantId,
  endpointId,
  originalEventId,
  now = new Date(),
}: {
  db: ReplayRateLimitDb;
  tenantId: string;
  endpointId: string;
  originalEventId: string;
  now?: Date;
}) => {
  const recentReplays = await db.webhookDelivery.count({
    where: {
      tenantId,
      endpointId,
      eventId: { startsWith: `${originalEventId}:replay:` },
      createdAt: { gte: new Date(now.getTime() - WEBHOOK_REPLAY_WINDOW_MS) },
    },
  });
  return recentReplays >= WEBHOOK_REPLAY_LIMIT;
};
