import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestContext, requireTenant } from "./tenant.js";
import { prisma } from "@commerceos/database";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

const movementTypes = ["RECEIVE", "ADJUSTMENT", "RETURN", "RESTOCK"] as const;
type AdjustmentType = (typeof movementTypes)[number];

export const recordInventoryMovement = async (tx: any, input: {
  tenantId: string;
  productId: string;
  variantId: string;
  type: "RECEIVE" | "ADJUSTMENT" | "RETURN" | "RESTOCK" | "SALE";
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason?: string | null;
  referenceId?: string | null;
  createdByUserId?: string | null;
}) => tx.inventoryMovement.create({ data: input });

export const handleInventoryRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/inventory")) return false;

  try {
    const context = getRequestContext(req.headers);
    const tenantId = requireTenant(context);
    const userId = context.auth?.userId ?? null;

    if (url.pathname === "/inventory" && req.method === "GET") {
      const variants = await prisma.productVariant.findMany({
        where: { product: { store: { tenantId } } },
        select: {
          id: true,
          sku: true,
          stock: true,
          price: true,
          product: { select: { id: true, name: true, status: true, store: { select: { id: true, name: true, currency: true } } } },
        },
        orderBy: { updatedAt: "desc" },
      });
      const requestedThreshold = Number(url.searchParams.get("lowStock") ?? 5);
      const threshold = Number.isFinite(requestedThreshold) ? Math.max(0, Math.floor(requestedThreshold)) : 5;
      return json(res, 200, {
        threshold,
        summary: {
          skus: variants.length,
          units: variants.reduce((sum, variant) => sum + variant.stock, 0),
          lowStock: variants.filter((variant) => variant.stock > 0 && variant.stock <= threshold).length,
          outOfStock: variants.filter((variant) => variant.stock === 0).length,
        },
        items: variants.map((variant) => ({
          ...variant,
          price: variant.price.toString(),
          availability: variant.stock === 0 ? "OUT_OF_STOCK" : variant.stock <= threshold ? "LOW_STOCK" : "IN_STOCK",
        })),
      }) as never;
    }

    const movementMatch = url.pathname.match(/^\/inventory\/([^/]+)\/movements$/);
    if (movementMatch && req.method === "GET") {
      const variant = await prisma.productVariant.findFirst({ where: { id: movementMatch[1], product: { store: { tenantId } } }, select: { id: true, sku: true, product: { select: { name: true } } } });
      if (!variant) return json(res, 404, { error: "inventory_item_not_found" }) as never;
      const movements = await prisma.inventoryMovement.findMany({ where: { tenantId, variantId: variant.id }, orderBy: { createdAt: "desc" }, take: 100 });
      return json(res, 200, { variant, movements }) as never;
    }

    const adjustMatch = url.pathname.match(/^\/inventory\/([^/]+)\/adjust$/);
    if (adjustMatch && req.method === "POST") {
      const input = await readBody(req);
      const quantity = Number(input.quantity);
      const type = String(input.type ?? "ADJUSTMENT") as AdjustmentType;
      const reason = input.reason == null ? null : String(input.reason).trim() || null;
      if (!Number.isInteger(quantity) || quantity === 0) return json(res, 400, { error: "quantity must be a non-zero integer" }) as never;
      if (!movementTypes.includes(type)) return json(res, 400, { error: "invalid_inventory_movement_type" }) as never;
      const variantId = adjustMatch[1];

      const result = await prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.findFirst({
          where: { id: variantId, product: { store: { tenantId } } },
          include: { product: { select: { name: true } } },
        });
        if (!variant) throw new Error("INVENTORY_ITEM_NOT_FOUND");

        const nextStock = variant.stock + quantity;
        if (nextStock < 0) throw new Error("INSUFFICIENT_STOCK");

        // Optimistic concurrency guard: the update only succeeds if the stock
        // value we read is still current. This prevents stale stockBefore/
        // stockAfter ledger entries when multiple adjustments race.
        const updatedCount = await tx.productVariant.updateMany({
          where: { id: variant.id, stock: variant.stock },
          data: { stock: { increment: quantity } },
        });
        if (updatedCount.count !== 1) throw new Error("INVENTORY_CONFLICT");

        const movement = await recordInventoryMovement(tx, {
          tenantId,
          productId: variant.productId,
          variantId: variant.id,
          type,
          quantity,
          stockBefore: variant.stock,
          stockAfter: nextStock,
          reason,
          referenceId: input.referenceId ? String(input.referenceId) : null,
          createdByUserId: userId,
        });
        const updated = await tx.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
        return { variant: updated, movement };
      });
      return json(res, 200, { ...result, variant: { ...result.variant, price: result.variant.price.toString() } }) as never;
    }

    return json(res, 404, { error: "inventory_route_not_found" }) as never;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" }) as never;
    if (message === "INVENTORY_ITEM_NOT_FOUND") return json(res, 404, { error: "inventory_item_not_found" }) as never;
    if (message === "INSUFFICIENT_STOCK") return json(res, 409, { error: "insufficient_stock" }) as never;
    if (message === "INVENTORY_CONFLICT") return json(res, 409, { error: "inventory_conflict", message: "Stock changed while this adjustment was being processed. Please retry." }) as never;
    return json(res, 500, { error: "internal_server_error" }) as never;
  }
};
