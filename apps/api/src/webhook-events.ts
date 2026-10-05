import { prisma, Prisma } from "@commerceos/database";
import type { Prisma } from "@prisma/client";

export const queueWebhookEvent = async (
  event: { tenantId: string; eventId: string; eventType: string; payload: Record<string, unknown> },
  db: Prisma.TransactionClient | typeof prisma = prisma,
) => {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { tenantId: event.tenantId, status: "ACTIVE" },
    select: { id: true, events: true },
  });
  await Promise.all(endpoints.filter(endpoint => {
    const events = Array.isArray(endpoint.events) ? endpoint.events.map(String) : [];
    return events.includes("*") || events.includes(event.eventType);
  }).map(endpoint => db.webhookDelivery.upsert({
    where: { endpointId_eventId: { endpointId: endpoint.id, eventId: event.eventId } },
    create: {
      tenantId: event.tenantId,
      endpointId: endpoint.id,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.payload as Prisma.InputJsonValue,
    },
    update: {},
  })));
};
