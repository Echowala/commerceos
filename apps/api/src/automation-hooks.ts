import { triggerAutomations } from "./automation-engine.js";

export const triggerOrderPlacedAutomation = async (event: { tenantId: string; customerId: string; orderId: string; orderNumber: string; total: string; currency: string }) => {
  await triggerAutomations({
    tenantId: event.tenantId,
    trigger: "ORDER_PLACED",
    eventId: `order:${event.orderId}:placed`,
    customerId: event.customerId,
    data: { orderId: event.orderId, orderNumber: event.orderNumber, total: Number(event.total), currency: event.currency },
  });
};

export const triggerCustomerCreatedAutomation = async (event: { tenantId: string; customerId: string; email: string | null }) => {
  await triggerAutomations({
    tenantId: event.tenantId,
    trigger: "CUSTOMER_CREATED",
    eventId: `customer:${event.customerId}:created`,
    customerId: event.customerId,
    data: { customerId: event.customerId, email: event.email },
  });
};

export const triggerOrderStatusChangedAutomation = async (event: { tenantId: string; customerId: string | null; orderId: string; orderNumber: string; from: string; to: string }) => {
  await triggerAutomations({
    tenantId: event.tenantId,
    trigger: "ORDER_STATUS_CHANGED",
    eventId: `order:${event.orderId}:status:${event.from}:${event.to}`,
    customerId: event.customerId,
    data: { orderId: event.orderId, orderNumber: event.orderNumber, from: event.from, to: event.to },
  });
};

export const triggerInventoryLowAutomation = async (event: { tenantId: string; productId: string; variantId: string; stock: number; threshold: number }) => {
  await triggerAutomations({
    tenantId: event.tenantId,
    trigger: "INVENTORY_LOW",
    eventId: `inventory:${event.variantId}:low:${event.threshold}`,
    data: { productId: event.productId, variantId: event.variantId, stock: event.stock, threshold: event.threshold },
  });
};
