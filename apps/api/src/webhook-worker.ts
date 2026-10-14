import crypto from "node:crypto";
import { prisma } from "@commerceos/database";

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];

const signPayload = (secret: string, payload: string) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

const nextRetry = (attempt: number) =>
  new Date(Date.now() + (RETRY_DELAYS_MS[Math.max(0, attempt - 1)] ?? 3_600_000));

export const deliverWebhook = async (deliveryId: string) => {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.status === "DELIVERED") return delivery;

  const payload = JSON.stringify(delivery.payload);
  const attempt = delivery.attempts + 1;

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: "DELIVERING", attempts: attempt },
  });

  try {
    const response = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-commerceos-event": delivery.eventType,
        "x-commerceos-event-id": delivery.eventId,
        "x-commerceos-signature": `sha256=${signPayload(delivery.endpoint.secret, payload)}`,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with HTTP ${response.status}`);
    }

    return await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        availableAt: new Date(),
        lastError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook delivery failed";
    const terminal = attempt >= MAX_ATTEMPTS;

    return await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: terminal ? "FAILED" : "QUEUED",
        availableAt: terminal ? new Date() : nextRetry(attempt),
        lastError: message,
      },
    });
  }
};

export const processWebhookQueue = async (limit = 25) => {
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      status: "QUEUED",
      availableAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  return Promise.all(deliveries.map(({ id }) => deliverWebhook(id)));
};
