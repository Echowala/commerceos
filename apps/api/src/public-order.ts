import { prisma } from "@commerceos/database";
import { randomBytes } from "node:crypto";

const orderNumber = () => `CO-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
const paymentMethods = ["COD", "MANUAL_BANK", "CARD", "WALLET"] as const;

export async function createPublicOrder(tenantSlug: string, storeSlug: string, input: any) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error("ITEMS_REQUIRED");
  const store = await prisma.store.findFirst({ where: { slug: storeSlug, tenant: { slug: tenantSlug } } });
  if (!store) throw new Error("STORE_NOT_FOUND");
  const paymentMethod = input.paymentMethod ?? "COD";
  if (!paymentMethods.includes(paymentMethod)) throw new Error("INVALID_PAYMENT_METHOD");
  const shippingName = String(input.shippingName ?? input.customer?.name ?? "").trim();
  const shippingPhone = String(input.shippingPhone ?? input.customer?.phone ?? "").trim();
  const shippingAddress = String(input.shippingAddress ?? input.customer?.address ?? "").trim();
  if (!shippingName || !shippingPhone || !shippingAddress) throw new Error("SHIPPING_REQUIRED");

  return prisma.$transaction(async tx => {
    const email = input.customer?.email ? String(input.customer.email).trim().toLowerCase() : null;
    const phone = input.customer?.phone ? String(input.customer.phone).trim() : null;
    let customerId: string | undefined;
    if (email || phone) {
      const existing = await tx.customer.findFirst({ where: { tenantId: store.tenantId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
      customerId = existing?.id ?? (await tx.customer.create({ data: { tenantId: store.tenantId, email, phone, firstName: input.customer?.firstName, lastName: input.customer?.lastName } })).id;
    }

    const orderItems: { productId: string; variantId: string; name: string; quantity: number; unitPrice: number; total: number }[] = [];
    let subtotal = 0;
    for (const item of input.items) {
      const quantity = Number(item?.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
      const variant = await tx.productVariant.findFirst({ where: { id: item?.variantId, product: { storeId: store.id, status: "ACTIVE" } }, include: { product: true } });
      if (!variant) throw new Error("ITEM_NOT_FOUND");
      const price = Number(variant.price);
      const updated = await tx.productVariant.updateMany({ where: { id: variant.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
      if (updated.count !== 1) throw new Error("INSUFFICIENT_STOCK");
      const total = price * quantity;
      orderItems.push({ productId: variant.productId, variantId: variant.id, name: variant.product.name, quantity, unitPrice: price, total });
      subtotal += total;
    }

    return tx.order.create({ data: { tenantId: store.tenantId, storeId: store.id, customerId, orderNumber: orderNumber(), status: "CONFIRMED", paymentStatus: "PENDING", paymentMethod, subtotal, total: subtotal, currency: store.currency, shippingName, shippingPhone, shippingAddress, items: { create: orderItems } } });
  });
}
