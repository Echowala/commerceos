import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@commerceos/database";
import { triggerCustomerCreatedAutomation, triggerInventoryLowAutomation, triggerOrderPlacedAutomation } from "./automation-hooks.js";

const orderNumber = () => `CO-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

type CheckoutItem = { variantId: string; quantity: number };
type CheckoutInput = {
  customer?: { email?: unknown; name?: unknown; phone?: unknown; address?: unknown };
  shippingName?: unknown;
  shippingPhone?: unknown;
  shippingAddress?: unknown;
  items: CheckoutItem[];
};

const checkoutFingerprint = (input: CheckoutInput) => createHash("sha256").update(JSON.stringify({
  customer: {
    email: input.customer?.email ? String(input.customer.email).trim().toLowerCase() : null,
    name: String(input.shippingName ?? input.customer?.name ?? "").trim(),
    phone: String(input.shippingPhone ?? input.customer?.phone ?? "").trim(),
    address: String(input.shippingAddress ?? input.customer?.address ?? "").trim(),
  },
  items: [...input.items].map(item => ({ variantId: String(item.variantId ?? ""), quantity: Number(item.quantity) })).sort((a, b) => a.variantId.localeCompare(b.variantId) || a.quantity - b.quantity),
})).digest("hex");

type PublicOrderResult = {
  order: Awaited<ReturnType<typeof prisma.order.findFirst>> & NonNullable<Awaited<ReturnType<typeof prisma.order.findFirst>>>;
  replayed: boolean;
};

export async function createPublicOrder(input: CheckoutInput, tenantSlug: string, storeSlug: string, idempotencyKey: string | null = null): Promise<PublicOrderResult> {
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) throw new Error("ITEMS_REQUIRED");
  const email = input.customer?.email ? String(input.customer.email).trim().toLowerCase() : null;
  const shippingName = String(input.shippingName ?? input.customer?.name ?? "").trim();
  const shippingPhone = String(input.shippingPhone ?? input.customer?.phone ?? "").trim();
  const shippingAddress = String(input.shippingAddress ?? input.customer?.address ?? "").trim();
  if (!email || !shippingName || !shippingPhone || !shippingAddress) throw new Error("SHIPPING_REQUIRED");

  const store = await prisma.store.findFirst({ where: { slug: storeSlug, tenant: { slug: tenantSlug } } });
  if (!store) throw new Error("STORE_NOT_FOUND");
  const fingerprint = idempotencyKey ? checkoutFingerprint(input) : null;

  if (idempotencyKey) {
    const existing = await prisma.order.findFirst({ where: { storeId: store.id, idempotencyKey } });
    if (existing) {
      if (existing.idempotencyFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_KEY_REUSED");
      return { order: existing, replayed: true };
    }
  }

  try {
    const result = await prisma.$transaction(async tx => {
      if (idempotencyKey) {
        const existing = await tx.order.findFirst({ where: { storeId: store.id, idempotencyKey } });
        if (existing) {
          if (existing.idempotencyFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_KEY_REUSED");
          return { order: existing, customerCreated: false, replayed: true, lowStockItems: [] };
        }
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${store.tenantId}:${email}`}, 0))`;
      let customer = await tx.customer.findFirst({ where: { tenantId: store.tenantId, email } });
      const customerCreated = !customer;
      if (!customer) {
        customer = await tx.customer.create({ data: { tenantId: store.tenantId, email, phone: shippingPhone, firstName: shippingName } });
      } else {
        const customerData: { phone?: string; firstName?: string } = {};
        if (!customer.phone && shippingPhone) customerData.phone = shippingPhone;
        if (!customer.firstName && shippingName) customerData.firstName = shippingName;
        if (Object.keys(customerData).length > 0) customer = await tx.customer.update({ where: { id: customer.id }, data: customerData });
      }

      const orderItems: { productId: string; variantId: string; name: string; quantity: number; unitPrice: number; total: number }[] = [];
      const movements: { productId: string; variantId: string; quantity: number; stockBefore: number; stockAfter: number; crossedIntoLowStock: boolean }[] = [];
      let subtotal = 0;
      for (const raw of input.items) {
        const quantity = Number(raw.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
        const variant = await tx.productVariant.findFirst({ where: { id: raw.variantId, product: { storeId: store.id, status: "ACTIVE" } }, include: { product: true } });
        if (!variant) throw new Error("ITEM_NOT_FOUND");
        const updated = await tx.productVariant.updateMany({ where: { id: variant.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
        if (updated.count !== 1) throw new Error("INSUFFICIENT_STOCK");
        const stockAfter = variant.stock - quantity;
        const unitPrice = Number(variant.price); const total = unitPrice * quantity;
        orderItems.push({ productId: variant.productId, variantId: variant.id, name: variant.product.name, quantity, unitPrice, total });
        movements.push({ productId: variant.productId, variantId: variant.id, quantity: -quantity, stockBefore: variant.stock, stockAfter, crossedIntoLowStock: variant.stock > 5 && stockAfter > 0 && stockAfter <= 5 });
        subtotal += total;
      }
      const order = await tx.order.create({ data: { tenantId: store.tenantId, storeId: store.id, customerId: customer.id, orderNumber: orderNumber(), idempotencyKey, idempotencyFingerprint: fingerprint, status: "CONFIRMED", paymentStatus: "PENDING", paymentMethod: "COD", subtotal, total: subtotal, currency: store.currency, shippingName, shippingPhone, shippingAddress, items: { create: orderItems } } });
      await tx.inventoryMovement.createMany({ data: movements.map(movement => ({ tenantId: store.tenantId, productId: movement.productId, variantId: movement.variantId, type: "SALE", quantity: movement.quantity, stockBefore: movement.stockBefore, stockAfter: movement.stockAfter, referenceId: order.id, reason: `Order ${order.orderNumber}` })) });
      await tx.customerEvent.createMany({ data: [
        ...(customerCreated ? [{ tenantId: store.tenantId, customerId: customer.id, type: "CUSTOMER_CREATED" as const, data: { source: "public_checkout" } }] : []),
        { tenantId: store.tenantId, customerId: customer.id, type: "ORDER_PLACED" as const, data: { orderId: order.id, orderNumber: order.orderNumber, total: order.total.toString(), currency: order.currency } },
      ] });
      if (customerCreated) {
        await triggerCustomerCreatedAutomation({ tenantId: store.tenantId, customerId: customer.id, email }, tx);
      }
      await triggerOrderPlacedAutomation({ tenantId: store.tenantId, customerId: customer.id, orderId: order.id, orderNumber: order.orderNumber, total: order.total.toString(), currency: order.currency }, tx);
      for (const item of movements.filter(movement => movement.crossedIntoLowStock)) {
        await triggerInventoryLowAutomation({ tenantId: store.tenantId, productId: item.productId, variantId: item.variantId, stock: item.stockAfter, threshold: 5, referenceId: `${order.id}:${item.variantId}` }, tx);
      }
      return { order, customerCreated, replayed: false, lowStockItems: movements.filter(movement => movement.crossedIntoLowStock) };
    });

    return { order: result.order, replayed: result.replayed };
  } catch (error) {
    if (idempotencyKey && error instanceof Error && error.message.includes("Order_storeId_idempotencyKey_key")) {
      const existing = await prisma.order.findFirst({ where: { storeId: store.id, idempotencyKey } });
      if (existing) {
        if (existing.idempotencyFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_KEY_REUSED");
        return { order: existing, replayed: true };
      }
    }
    throw error;
  }
}
