import { triggerAutomations } from "./automation-engine.js";

export const triggerOrderPlacedAutomation = async (event: { tenantId: string; customerId: string; orderId: string; orderNumber: string; total: string; currency: string }) => {
  await triggerAutomations({
    tenantId: event.tenantId,
    trigger: "ORDER_PLACED",
    customerId: event.customerId,
    data: { orderId: event.orderId, orderNumber: event.orderNumber, total: Number(event.total), currency: event.currency },
  });
};

export const triggerCustomerCreatedAutomation = async (event: { tenantId: string; customerId: string; email: string | null }) => {
  await triggerAutomations({
    tenantId: event.tenantId,
    trigger: "CUSTOMER_CREATED",
    customerId: event.customerId,
    data: { customerId: event.customerId, email: event.email },
  });
};
