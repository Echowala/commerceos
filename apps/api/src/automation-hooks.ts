import { prisma } from "@commerceos/database";
import type { Prisma } from "@prisma/client";
import { triggerAutomations } from "./automation-engine.js";

type Event = {
  tenantId: string;
  trigger: "ORDER_PLACED" | "ORDER_STATUS_CHANGED" | "CUSTOMER_CREATED" | "INVENTORY_LOW";
  eventId: string;
  customerId?: string | null;
  data: Record<string, unknown>;
};

export const enqueueAutomationEvent = async (event: Event): Promise<void> => {
  await prisma.automationJob.upsert({
    where: { eventId: event.eventId },
    create: {
      tenantId: event.tenantId,
      trigger: event.trigger,
      eventId: event.eventId,
      customerId: event.customerId ?? null,
      data: event.data,
    },
    update: {},
  });
};

export const triggerOrderPlacedAutomation = async (event: { tenantId: string; customerId: string; orderId: string; orderNumber: string; total: string; currency: string }, db: Prisma.TransactionClient | typeof prisma = prisma) => {
  await enqueueAutomationEvent({ tenantId: event.tenantId, trigger: "ORDER_PLACED", eventId: `order:${event.orderId}:placed`, customerId: event.customerId, data: { orderId: event.orderId, orderNumber: event.orderNumber, total: Number(event.total), currency: event.currency } }, db);
};

export const triggerCustomerCreatedAutomation = async (event: { tenantId: string; customerId: string; email: string | null }, db: Prisma.TransactionClient | typeof prisma = prisma) => {
  await enqueueAutomationEvent({ tenantId: event.tenantId, trigger: "CUSTOMER_CREATED", eventId: `customer:${event.customerId}:created`, customerId: event.customerId, data: { customerId: event.customerId, email: event.email } }, db);
};

export const triggerOrderStatusChangedAutomation = async (event: { tenantId: string; customerId: string | null; orderId: string; orderNumber: string; from: string; to: string }, db: Prisma.TransactionClient | typeof prisma = prisma) => {
  await enqueueAutomationEvent({ tenantId: event.tenantId, trigger: "ORDER_STATUS_CHANGED", eventId: `order:${event.orderId}:status:${event.from}:${event.to}`, customerId: event.customerId, data: { orderId: event.orderId, orderNumber: event.orderNumber, from: event.from, to: event.to } }, db);
};

export const triggerInventoryLowAutomation = async (event: { tenantId: string; productId: string; variantId: string; stock: number; threshold: number; referenceId?: string | null }, db: Prisma.TransactionClient | typeof prisma = prisma) => {
  const eventId = `inventory:${event.variantId}:low:${event.threshold}:${event.referenceId ?? "threshold"}`;
  await enqueueAutomationEvent({ tenantId: event.tenantId, trigger: "INVENTORY_LOW", eventId, data: { productId: event.productId, variantId: event.variantId, stock: event.stock, threshold: event.threshold } }, db);
};

