import { randomBytes } from "node:crypto";
import { prisma } from "@commerceos/database";

const orderNumber = () => `CO-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

export async function createPublicOrder(input: any, tenantSlug: string, storeSlug: string) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error("ITEMS_REQUIRED");
  const email = input.customer?.email ? String(input.customer.email).trim().toLowerCase() : null;
  const shippingName = String(input.shippingName ?? input.customer?.name ?? "").trim();
  const shippingPhone = String(input.shippingPhone ?? input.customer?.phone ?? "").trim();
  const shippingAddress = String(input.shippingAddress ?? input.customer?.address ?? "").trim();
  if (!email || !shippingName || !shippingPhone || !shippingAddress) throw new Error("SHIPPING_REQUIRED");

  const store = await prisma.store.findFirst({ where: { slug: storeSlug, tenant: { slug: tenantSlug } } });
  if (!store) throw new Error("STORE_NOT_FOUND");

  return prisma.$transaction(async tx => {
    const customer = await tx.customer.findFirst({ where: { tenantId: store.tenantId, email } });
    const customerId = customer?.id ?? (await tx.customer.create({ data: { tenantId: store.tenantId, email, phone: shippingPhone, firstName: shippingName } })).id;
    const orderItems: { productId: string; variantId: string; name: string; quantity: number; unitPrice: number; total: number }[] = [];
    let subtotal = 0;
    for (const raw of input.items) {
      const quantity = Number(raw.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
      const variant = await tx.productVariant.findFirst({ where: { id: raw.variantId, product: { storeId: store.id, status: "ACTIVE" } }, include: { product: true } });
      if (!variant) throw new Error("ITEM_NOT_FOUND");
      const updated = await tx.productVariant.updateMany({ where: { id: variant.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
      if (updated.count !== 1) throw new Error("INSUFFICIENT_STOCK");
      const unitPrice = Number(variant.price); const total = unitPrice * quantity;
      orderItems.push({ productId: variant.productId, variantId: variant.id, name: variant.product.name, quantity, unitPrice, total });
      subtotal += total;
    }
    return tx.order.create({ data: { tenantId: store.tenantId, storeId: store.id, customerId, orderNumber: orderNumber(), status: "CONFIRMED", paymentStatus: "PENDING", paymentMethod: "COD", subtotal, total: subtotal, currency: store.currency, shippingName, shippingPhone, shippingAddress, items: { create: orderItems } } });
  });
}
