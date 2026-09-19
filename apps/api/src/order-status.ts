import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { recordInventoryMovement } from "./inventory.js";
import { getRequestContext, requireRole, requireTenant } from "./tenant.js";
import { triggerOrderStatusChangedAutomation } from "./automation-hooks.js";

const json = (res: ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
const body = async (req: IncomingMessage) => { let raw = ""; for await (const chunk of req) raw += chunk; if (raw.length > 1_000_000) throw new Error("PAYLOAD_TOO_LARGE"); return raw ? JSON.parse(raw) : {}; };
const orderStatuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const;
type OrderStatus = (typeof orderStatuses)[number];
const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = { PENDING: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["PROCESSING", "CANCELLED"], PROCESSING: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED", "CANCELLED", "REFUNDED"], DELIVERED: ["REFUNDED"], CANCELLED: ["REFUNDED"], REFUNDED: [] };
const stockReleasingStatuses = new Set<OrderStatus>(["CANCELLED", "REFUNDED"]);

export const handleOrderStatusRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost"); const match = url.pathname.match(/^\/orders\/([^/]+)\/status$/); if (!match || req.method !== "PATCH") return false;
  res.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN ?? "http://localhost:3000"); res.setHeader("access-control-allow-headers", "content-type, authorization, idempotency-key"); res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  try {
    const context = getRequestContext(req.headers); const tenantId = requireTenant(context); requireRole(context, "OWNER", "ADMIN"); const input = await body(req); const status = String(input.status ?? "") as OrderStatus;
    if (!orderStatuses.includes(status)) return json(res, 400, { error: "invalid_order_status" }) as never;
    const result = await prisma.$transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id: match[1], tenantId }, include: { items: true } });
      if (!order) throw new Error("ORDER_NOT_FOUND"); if (order.status === status) return { id: order.id, orderNumber: order.orderNumber, status: order.status, customerId: order.customerId, from: order.status as OrderStatus };
      const currentStatus = order.status as OrderStatus; if (!allowedTransitions[currentStatus].includes(status)) throw new Error(`INVALID_ORDER_TRANSITION:${currentStatus}:${status}`);
      const shouldReleaseStock = stockReleasingStatuses.has(status) && !stockReleasingStatuses.has(currentStatus);
      if (shouldReleaseStock) {
        const claimed = await tx.order.updateMany({
          where: { id: order.id, tenantId, status: currentStatus, inventoryReleasedAt: null },
          data: { inventoryReleasedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("ORDER_STATE_CONFLICT");

        // Release only inventory that was actually sold for this order. This prevents
        // cancelled/refunded orders created without inventory deduction from creating
        // phantom stock, while keeping the release idempotent via inventoryReleasedAt.
        const saleMovements = await tx.inventoryMovement.findMany({
          where: { tenantId, referenceId: order.id, type: "SALE" },
          select: { productId: true, variantId: true, quantity: true },
        });
        const quantities = new Map<string, { productId: string; quantity: number }>();
        for (const movement of saleMovements) {
          const releasedQuantity = Math.max(0, -movement.quantity);
          if (releasedQuantity === 0) continue;
          const existing = quantities.get(movement.variantId);
          if (existing) existing.quantity += releasedQuantity;
          else quantities.set(movement.variantId, { productId: movement.productId, quantity: releasedQuantity });
        }

        for (const [variantId, release] of quantities) {
          const variant = await tx.productVariant.findFirst({
            where: { id: variantId, product: { store: { tenantId } } },
            select: { id: true, productId: true, stock: true },
          });
          if (!variant) throw new Error("ORDER_ITEM_NOT_FOUND");

          const stockBefore = variant.stock;
          const stockAfter = stockBefore + release.quantity;
          const guarded = await tx.productVariant.updateMany({
            where: { id: variant.id, stock: stockBefore },
            data: { stock: { increment: release.quantity } },
          });
          if (guarded.count !== 1) throw new Error("INVENTORY_CONFLICT");

          await recordInventoryMovement(tx, {
            tenantId,
            productId: variant.productId,
            variantId: variant.id,
            type: "RETURN",
            quantity: release.quantity,
            stockBefore,
            stockAfter,
            referenceId: order.id,
            reason: `${status} order ${order.orderNumber}`,
            createdByUserId: context.auth?.userId ?? null,
          });
        }
      }
      const updated = await tx.order.updateMany({ where: { id: order.id, tenantId, status: currentStatus }, data: { status } }); if (updated.count !== 1) throw new Error("ORDER_STATE_CONFLICT");
      if (order.customerId) await tx.customerEvent.create({ data: { tenantId, customerId: order.customerId, type: "ORDER_STATUS_CHANGED", data: { orderId: order.id, orderNumber: order.orderNumber, from: currentStatus, to: status } } });
      return { id: order.id, orderNumber: order.orderNumber, status, customerId: order.customerId, from: currentStatus };
    });
    if (result.from !== result.status) {
      void triggerOrderStatusChangedAutomation({ tenantId, customerId: result.customerId, orderId: result.id, orderNumber: result.orderNumber, from: result.from, to: result.status }).catch(() => undefined);
    }
    return json(res, 200, { id: result.id, orderNumber: result.orderNumber, status: result.status }) as never;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" }) as never;
    if (message === "FORBIDDEN") return json(res, 403, { error: "forbidden" }) as never;
    if (message === "PAYLOAD_TOO_LARGE") return json(res, 413, { error: "payload_too_large" }) as never;
    if (message === "ORDER_NOT_FOUND") return json(res, 404, { error: "order_not_found" }) as never;
    if (message.startsWith("INVALID_ORDER_TRANSITION:")) { const [, from, to] = message.split(":"); return json(res, 409, { error: "invalid_order_transition", from, to }) as never; }
    if (message === "ORDER_ITEM_NOT_FOUND") return json(res, 409, { error: "order_item_not_found" }) as never;
    if (message === "INVENTORY_CONFLICT") return json(res, 409, { error: "inventory_conflict", message: "Stock changed while the order inventory was being released. Please retry." }) as never;
    if (message === "ORDER_STATE_CONFLICT") return json(res, 409, { error: "order_state_conflict", message: "Order status changed while this update was being processed. Please retry." }) as never;
    return json(res, 500, { error: "internal_server_error" }) as never;
  }
};
