import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { recordInventoryMovement } from "./inventory.js";
import { getRequestContext, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const body = async (req: IncomingMessage) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length > 1_000_000) throw new Error("PAYLOAD_TOO_LARGE");
  return raw ? JSON.parse(raw) : {};
};

const orderStatuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const;
const stockReleasingStatuses = new Set(["CANCELLED", "REFUNDED"]);

export const handleOrderStatusRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/orders\/([^/]+)\/status$/);
  if (!match || req.method !== "PATCH") return false;

  res.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN ?? "http://localhost:3000");
  res.setHeader("access-control-allow-headers", "content-type, authorization, idempotency-key");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");

  try {
    const context = getRequestContext(req.headers);
    const tenantId = requireTenant(context);
    const input = await body(req);
    const status = String(input.status ?? "");
    if (!orderStatuses.includes(status as typeof orderStatuses[number])) return json(res, 400, { error: "invalid_order_status" }) as never;

    const order = await prisma.order.findFirst({
      where: { id: match[1], tenantId },
      include: { items: true },
    });
    if (!order) return json(res, 404, { error: "order_not_found" }) as never;
    if (order.status === status) return json(res, 200, { id: order.id, orderNumber: order.orderNumber, status: order.status }) as never;

    const shouldReleaseStock = stockReleasingStatuses.has(status) && !stockReleasingStatuses.has(order.status);
    const updated = await prisma.$transaction(async tx => {
      if (shouldReleaseStock) {
        // Claim the one-time stock release on the order row. Concurrent
        // cancellation/refund requests can both reach this point, but only
        // one transaction can change inventoryReleasedAt from NULL.
        const claimed = await tx.order.updateMany({
          where: { id: order.id, tenantId, inventoryReleasedAt: null },
          data: { inventoryReleasedAt: new Date() },
        });

        if (claimed.count === 1) {
          // Multiple order lines may reference the same variant. Aggregate them
          // so the inventory ledger gets exactly one RETURN movement per SKU.
          const quantities = new Map<string, { productId: string; quantity: number }>();
          for (const item of order.items) {
            const existing = quantities.get(item.variantId);
            if (existing) existing.quantity += item.quantity;
            else quantities.set(item.variantId, { productId: item.productId, quantity: item.quantity });
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
      }

      return tx.order.update({
        where: { id: order.id },
        data: { status: status as typeof orderStatuses[number] },
      });
    });

    return json(res, 200, { id: updated.id, orderNumber: updated.orderNumber, status: updated.status }) as never;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" }) as never;
    if (message === "PAYLOAD_TOO_LARGE") return json(res, 413, { error: "payload_too_large" }) as never;
    if (message === "ORDER_ITEM_NOT_FOUND") return json(res, 409, { error: "order_item_not_found" }) as never;
    if (message === "INVENTORY_CONFLICT") return json(res, 409, { error: "inventory_conflict", message: "Stock changed while the order inventory was being released. Please retry." }) as never;
    return json(res, 500, { error: "internal_server_error" }) as never;
  }
};
