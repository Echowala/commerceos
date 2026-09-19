import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { prisma } from "@commerceos/database";
import { createToken, verifyPassword } from "./auth.js";
import { signup } from "./signup.js";
import { createPublicOrder } from "./public-checkout.js";
import { recordInventoryMovement } from "./inventory.js";
import { getRequestContext, requireRole, requireTenant } from "./tenant.js";
import { triggerInventoryLowAutomation, triggerOrderPlacedAutomation } from "./automation-hooks.js";

const json = (res: ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
const body = async (req: IncomingMessage) => { let raw = ""; for await (const chunk of req) raw += chunk; if (raw.length > 1_000_000) throw new Error("PAYLOAD_TOO_LARGE"); return raw ? JSON.parse(raw) : {}; };
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const orderNumber = () => `CO-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
const orderStatuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const;
const productStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
const stockReleasingStatuses = new Set(["CANCELLED", "REFUNDED"]);

export const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN ?? "http://localhost:3000");
  res.setHeader("access-control-allow-headers", "content-type, authorization, idempotency-key");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return json(res, 204, null);
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health" && req.method === "GET") return json(res, 200, { name: "CommerceOS API", status: "ok" });
    if (url.pathname === "/ready" && req.method === "GET") { await prisma.$queryRaw`SELECT 1`; return json(res, 200, { status: "ready", database: "ok" }); }
    if (url.pathname === "/auth/signup" && req.method === "POST") return json(res, 201, await signup(await body(req)));
    if (url.pathname === "/auth/dev-login" && req.method === "POST") {
      if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_LOGIN !== "true") return json(res, 404, { error: "not_found" });
      const input = await body(req);
      const user = await prisma.user.findFirst({ where: { email: String(input.email ?? "").trim().toLowerCase(), tenantId: input.tenantId } });
      if (!user || !verifyPassword(String(input.password ?? ""), user.passwordHash)) return json(res, 401, { error: "invalid_credentials" });
      return json(res, 200, { token: createToken({ userId: user.id, tenantId: user.tenantId, role: user.role, sessionVersion: user.sessionVersion }) });
    }

    const publicStoreMatch = url.pathname.match(/^\/public\/stores\/([^/]+)\/([^/]+)$/);
    if (publicStoreMatch && req.method === "GET") {
      const tenantSlug = decodeURIComponent(publicStoreMatch[1]); const storeSlug = decodeURIComponent(publicStoreMatch[2]);
      const store = await prisma.store.findFirst({ where: { slug: storeSlug, tenant: { slug: tenantSlug } }, select: { id: true, name: true, slug: true, currency: true, tenant: { select: { slug: true } }, products: { where: { status: "ACTIVE" }, include: { variants: { select: { id: true, sku: true, price: true, stock: true } } }, orderBy: { createdAt: "desc" } } } });
      if (!store) return json(res, 404, { error: "store_not_found" });
      return json(res, 200, { ...store, products: store.products.map(product => ({ ...product, variants: product.variants.map(variant => ({ id: variant.id, sku: variant.sku, price: variant.price.toString(), inStock: variant.stock > 0 })) })) });
    }
    const publicCheckoutMatch = url.pathname.match(/^\/public\/stores\/([^/]+)\/([^/]+)\/orders$/);
    if (publicCheckoutMatch && req.method === "POST") {
      const tenantSlug = decodeURIComponent(publicCheckoutMatch[1]); const storeSlug = decodeURIComponent(publicCheckoutMatch[2]);
      const idempotencyKey = String(req.headers["idempotency-key"] ?? "").trim();
      if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 128)) return json(res, 400, { error: "invalid_idempotency_key" });
      const input = await body(req); if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) return json(res, 400, { error: "items must contain between 1 and 100 entries" });
      const result = await createPublicOrder(input, tenantSlug, storeSlug, idempotencyKey || null);
      return json(res, result.replayed ? 200 : 201, { orderNumber: result.order.orderNumber, total: result.order.total.toString(), currency: result.order.currency, paymentMethod: result.order.paymentMethod, status: result.order.status });
    }
    const publicOrderMatch = url.pathname.match(/^\/public\/stores\/([^/]+)\/([^/]+)\/orders\/([^/]+)$/);
    if (publicOrderMatch && req.method === "GET") {
      const tenantSlug = decodeURIComponent(publicOrderMatch[1]); const storeSlug = decodeURIComponent(publicOrderMatch[2]); const orderNo = decodeURIComponent(publicOrderMatch[3]); const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
      if (!email) return json(res, 400, { error: "email is required" });
      const order = await prisma.order.findFirst({ where: { orderNumber: orderNo, store: { slug: storeSlug, tenant: { slug: tenantSlug } }, customer: { email } }, select: { orderNumber: true, status: true, paymentStatus: true, paymentMethod: true, subtotal: true, total: true, currency: true, shippingName: true, shippingAddress: true, createdAt: true, items: { select: { name: true, quantity: true, unitPrice: true, total: true }, orderBy: { name: "asc" } } } });
      if (!order) return json(res, 404, { error: "order_not_found" });
      return json(res, 200, { ...order, subtotal: order.subtotal.toString(), total: order.total.toString(), createdAt: order.createdAt.toISOString(), items: order.items.map(item => ({ ...item, unitPrice: item.unitPrice.toString(), total: item.total.toString() })) });
    }

    const context = await getRequestContext(req.headers); const tenantId = requireTenant(context);
    if (url.pathname === "/auth/logout" && req.method === "POST") {
      await prisma.user.update({ where: { id: context.auth!.userId }, data: { sessionVersion: { increment: 1 } } });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/me" && req.method === "GET") { const user = await prisma.user.findFirst({ where: { id: context.auth!.userId, tenantId }, select: { id: true, email: true, name: true, role: true, tenant: { select: { id: true, name: true, slug: true } } } }); return user ? json(res, 200, user) : json(res, 404, { error: "user_not_found" }); }
    if (url.pathname === "/dashboard" && req.method === "GET") { const [stores, products, orders, customers, revenue] = await Promise.all([prisma.store.count({ where: { tenantId } }), prisma.product.count({ where: { store: { tenantId }, status: "ACTIVE" } }), prisma.order.count({ where: { tenantId } }), prisma.customer.count({ where: { tenantId } }), prisma.order.aggregate({ where: { tenantId, paymentStatus: "PAID" }, _sum: { total: true } })]); return json(res, 200, { stores, products, orders, customers, revenue: revenue._sum.total?.toString() ?? "0" }); }
    if (url.pathname === "/stores" && req.method === "GET") return json(res, 200, await prisma.store.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }));
    if (url.pathname === "/stores" && req.method === "POST") { requireRole(context, "OWNER", "ADMIN"); const input = await body(req); if (!input.name) return json(res, 400, { error: "name is required" }); const slug = slugify(input.slug ?? input.name); if (!slug) return json(res, 400, { error: "valid slug is required" }); return json(res, 201, await prisma.store.create({ data: { tenantId, name: input.name, slug, currency: input.currency ?? "PKR" } })); }
    if (url.pathname === "/products" && req.method === "GET") return json(res, 200, await prisma.product.findMany({ where: { store: { tenantId } }, include: { variants: true }, orderBy: { createdAt: "desc" } }));
    const productMatch = url.pathname.match(/^\/products\/([^/]+)$/);
    if (productMatch && req.method === "GET") { const product = await prisma.product.findFirst({ where: { id: productMatch[1], store: { tenantId } }, include: { variants: true, store: { select: { id: true, name: true, currency: true } } } }); return product ? json(res, 200, product) : json(res, 404, { error: "product_not_found" }); }
    if (url.pathname === "/products" && req.method === "POST") { requireRole(context, "OWNER", "ADMIN");
      const input = await body(req); if (!input.storeId || !input.name || !input.variant?.sku || input.variant?.price == null) return json(res, 400, { error: "storeId, name and variant sku/price are required" });
      const store = await prisma.store.findFirst({ where: { id: input.storeId, tenantId } }); if (!store) return json(res, 404, { error: "store_not_found" });
      const slug = slugify(input.slug ?? input.name); if (!slug) return json(res, 400, { error: "valid slug is required" });
      const price = Number(input.variant.price); const stock = Number(input.variant.stock ?? 0);
      if (!Number.isFinite(price) || price < 0) return json(res, 400, { error: "price must be a non-negative number" });
      if (!Number.isInteger(stock) || stock < 0) return json(res, 400, { error: "stock must be a non-negative integer" });
      if (!productStatuses.includes((input.status ?? "DRAFT") as typeof productStatuses[number])) return json(res, 400, { error: "invalid_product_status" });
      const created = await prisma.$transaction(async tx => { const product = await tx.product.create({ data: { storeId: store.id, name: String(input.name).trim(), slug, description: input.description, status: input.status ?? "DRAFT", variants: { create: { sku: String(input.variant.sku).trim(), price, stock: 0 } } }, include: { variants: true } }); const variant = product.variants[0]; if (stock > 0 && variant) { await tx.productVariant.update({ where: { id: variant.id }, data: { stock } }); await recordInventoryMovement(tx, { tenantId, productId: product.id, variantId: variant.id, type: "RECEIVE", quantity: stock, stockBefore: 0, stockAfter: stock, reason: "Initial product stock", createdByUserId: context.auth!.userId }); } return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } }); });
      return json(res, 201, created);
    }
    if (productMatch && req.method === "PATCH") { requireRole(context, "OWNER", "ADMIN");
      const input = await body(req); const product = await prisma.product.findFirst({ where: { id: productMatch[1], store: { tenantId } }, include: { variants: true } }); if (!product) return json(res, 404, { error: "product_not_found" });
      const data: { name?: string; slug?: string; description?: string | null; status?: typeof productStatuses[number] } = {};
      if (input.name !== undefined) { const name = String(input.name).trim(); if (!name) return json(res, 400, { error: "name cannot be empty" }); data.name = name; }
      if (input.slug !== undefined) { const slug = slugify(String(input.slug)); if (!slug) return json(res, 400, { error: "valid slug is required" }); data.slug = slug; }
      if (input.description !== undefined) data.description = input.description == null ? null : String(input.description);
      if (input.status !== undefined) { const status = String(input.status); if (!productStatuses.includes(status as typeof productStatuses[number])) return json(res, 400, { error: "invalid_product_status" }); data.status = status as typeof productStatuses[number]; }
      const variantInput = input.variant;
      if (variantInput !== undefined) { if (!product.variants[0]) return json(res, 400, { error: "product_variant_not_found" }); const variantData: { sku?: string; price?: number } = {}; let targetStock: number | undefined; if (variantInput.sku !== undefined) { const sku = String(variantInput.sku).trim(); if (!sku) return json(res, 400, { error: "sku cannot be empty" }); variantData.sku = sku; } if (variantInput.price !== undefined) { const price = Number(variantInput.price); if (!Number.isFinite(price) || price < 0) return json(res, 400, { error: "price must be a non-negative number" }); variantData.price = price; } if (variantInput.stock !== undefined) { const stock = Number(variantInput.stock); if (!Number.isInteger(stock) || stock < 0) return json(res, 400, { error: "stock must be a non-negative integer" }); targetStock = stock; } const variantId = product.variants[0].id; const currentStock = product.variants[0].stock; const updated = await prisma.$transaction(async tx => { const updatedProduct = await tx.product.update({ where: { id: product.id }, data }); if (Object.keys(variantData).length > 0) await tx.productVariant.update({ where: { id: variantId }, data: variantData }); if (targetStock !== undefined && targetStock !== currentStock) { const delta = targetStock - currentStock; const guarded = await tx.productVariant.updateMany({ where: { id: variantId, stock: currentStock }, data: { stock: targetStock } }); if (guarded.count !== 1) throw new Error("INVENTORY_CONFLICT"); await recordInventoryMovement(tx, { tenantId, productId: product.id, variantId, type: "ADJUSTMENT", quantity: delta, stockBefore: currentStock, stockAfter: targetStock, reason: "Product stock edit", createdByUserId: context.auth!.userId }); } return tx.product.findUniqueOrThrow({ where: { id: updatedProduct.id }, include: { variants: true } }); }); return json(res, 200, updated); }
      return json(res, 200, await prisma.product.update({ where: { id: product.id }, data, include: { variants: true } }));
    }
    if (url.pathname === "/customers" && req.method === "GET") { const customers = await prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }); const result = await Promise.all(customers.map(async customer => { const stats = await prisma.order.aggregate({ where: { tenantId, customerId: customer.id }, _count: { _all: true }, _sum: { total: true } }); return { ...customer, orderCount: stats._count._all, totalSpend: stats._sum.total?.toString() ?? "0" }; })); return json(res, 200, result); }
    const customerMatch = url.pathname.match(/^\/customers\/([^/]+)$/);
    if (customerMatch && req.method === "GET") { const customer = await prisma.customer.findFirst({ where: { id: customerMatch[1], tenantId }, include: { orders: { orderBy: { createdAt: "desc" }, include: { store: true, items: true } } } }); if (!customer) return json(res, 404, { error: "customer_not_found" }); const totalSpend = customer.orders.reduce((sum, order) => sum + Number(order.total), 0); return json(res, 200, { ...customer, orderCount: customer.orders.length, totalSpend: totalSpend.toFixed(2) }); }
    if (url.pathname === "/customers" && req.method === "POST") { requireRole(context, "OWNER", "ADMIN"); const input = await body(req); const email = input.email ? String(input.email).trim().toLowerCase() : null; if (!email) return json(res, 400, { error: "email is required" }); const existing = await prisma.customer.findFirst({ where: { tenantId, email } }); if (existing) return json(res, 409, { error: "customer_exists" }); return json(res, 201, await prisma.customer.create({ data: { tenantId, email, firstName: input.firstName ? String(input.firstName).trim() : null, lastName: input.lastName ? String(input.lastName).trim() : null, phone: input.phone ? String(input.phone).trim() : null } })); }
    if (customerMatch && req.method === "PATCH") { requireRole(context, "OWNER", "ADMIN"); const input = await body(req); const customer = await prisma.customer.findFirst({ where: { id: customerMatch[1], tenantId } }); if (!customer) return json(res, 404, { error: "customer_not_found" }); const data: { email?: string; firstName?: string | null; lastName?: string | null; phone?: string | null } = {}; if (input.email !== undefined) { const email = String(input.email).trim().toLowerCase(); if (!email) return json(res, 400, { error: "email cannot be empty" }); data.email = email; } if (input.firstName !== undefined) data.firstName = input.firstName == null ? null : String(input.firstName).trim(); if (input.lastName !== undefined) data.lastName = input.lastName == null ? null : String(input.lastName).trim(); if (input.phone !== undefined) data.phone = input.phone == null ? null : String(input.phone).trim(); try { return json(res, 200, await prisma.customer.update({ where: { id: customer.id }, data })); } catch (error) { if (error instanceof Error && error.message.includes("Customer_tenantId_email_key")) return json(res, 409, { error: "customer_exists" }); throw error; } }
    if (url.pathname === "/orders" && req.method === "GET") return json(res, 200, await prisma.order.findMany({ where: { tenantId }, include: { customer: true, store: true, items: true }, orderBy: { createdAt: "desc" } }));
    const orderMatch = url.pathname.match(/^\/orders\/([^/]+)$/);
    if (orderMatch && req.method === "GET") { const order = await prisma.order.findFirst({ where: { id: orderMatch[1], tenantId }, include: { customer: true, store: true, items: true } }); return order ? json(res, 200, order) : json(res, 404, { error: "order_not_found" }); }
    if (url.pathname === "/orders" && req.method === "POST") { requireRole(context, "OWNER", "ADMIN");
      const input = await body(req);
      if (!input.storeId || !Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) return json(res, 400, { error: "storeId and 1-100 items are required" });
      const store = await prisma.store.findFirst({ where: { id: input.storeId, tenantId } });
      if (!store) return json(res, 404, { error: "store_not_found" });
      const customerId = input.customerId == null ? null : String(input.customerId);
      if (customerId) {
        const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
        if (!customer) return json(res, 404, { error: "customer_not_found" });
      }
      const requestedStatus = orderStatuses.includes(input.status) ? input.status : "PENDING";
      const created = await prisma.$transaction(async tx => {
        const order = await tx.order.create({ data: { tenantId, storeId: store.id, orderNumber: orderNumber(), status: requestedStatus, paymentStatus: input.paymentStatus ?? "PENDING", paymentMethod: input.paymentMethod ?? "COD", subtotal: 0, total: 0, currency: store.currency, shippingName: String(input.shippingName ?? "").trim(), shippingPhone: String(input.shippingPhone ?? "").trim(), shippingAddress: String(input.shippingAddress ?? "").trim(), customerId } });
        let subtotal = 0;
        const lowStockCrossings: Array<{ productId: string; variantId: string; stock: number; threshold: number; referenceId: string }> = [];
        for (const item of input.items) {
          const quantity = Number(item?.quantity);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
          const variant = await tx.productVariant.findFirst({ where: { id: String(item?.variantId ?? ""), product: { storeId: store.id, status: "ACTIVE" } }, include: { product: { select: { name: true } } } });
          if (!variant) throw new Error("ITEM_NOT_FOUND");
          const unitPrice = Number(variant.price);
          const total = unitPrice * quantity;
          subtotal += total;
          if (!stockReleasingStatuses.has(requestedStatus)) {
            const nextStock = variant.stock - quantity;
            if (nextStock < 0) throw new Error("INSUFFICIENT_STOCK");
            const updatedCount = await tx.productVariant.updateMany({ where: { id: variant.id, stock: variant.stock }, data: { stock: { decrement: quantity } } });
            if (updatedCount.count !== 1) throw new Error("INVENTORY_CONFLICT");
            const movement = await recordInventoryMovement(tx, { tenantId, productId: variant.productId, variantId: variant.id, type: "SALE", quantity: -quantity, stockBefore: variant.stock, stockAfter: nextStock, reason: "Admin order", referenceId: order.id, createdByUserId: context.auth!.userId });
            if (variant.stock > 5 && nextStock > 0 && nextStock <= 5) lowStockCrossings.push({ productId: variant.productId, variantId: variant.id, stock: nextStock, threshold: 5, referenceId: movement.id });
          }
          await tx.orderItem.create({ data: { orderId: order.id, productId: variant.productId, variantId: variant.id, name: variant.product.name, quantity, unitPrice, total } });
        }
        return tx.order.update({ where: { id: order.id }, data: { subtotal, total: subtotal }, include: { items: true } }).then(updated => ({ order: updated, lowStockCrossings }));
      });
      if (customerId) void triggerOrderPlacedAutomation({ tenantId, customerId, orderId: created.order.id, orderNumber: created.order.orderNumber, total: created.order.total.toString(), currency: created.order.currency }).catch(() => undefined);
      for (const crossing of created.lowStockCrossings) void triggerInventoryLowAutomation({ tenantId, ...crossing }).catch(() => undefined);
      return json(res, 201, created.order);
    }
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") return json(res, 413, { error: "payload_too_large" });
    if (error instanceof SyntaxError) return json(res, 400, { error: "invalid_json" });
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" });
    if (error instanceof Error && error.message === "FORBIDDEN") return json(res, 403, { error: "forbidden" });
    if (error instanceof Error && error.message === "TENANT_REQUIRED") return json(res, 401, { error: "tenant_required" });
    if (error instanceof Error && error.message === "STORE_NOT_FOUND") return json(res, 404, { error: "store_not_found" });
    if (error instanceof Error && error.message === "ITEMS_REQUIRED") return json(res, 400, { error: "items must contain between 1 and 100 entries" });
    if (error instanceof Error && error.message === "SHIPPING_REQUIRED") return json(res, 400, { error: "shipping fields are required" });
    if (error instanceof Error && error.message === "INVALID_QUANTITY") return json(res, 400, { error: "quantity must be a positive integer" });
    if (error instanceof Error && error.message === "ITEM_NOT_FOUND") return json(res, 404, { error: "item_not_found" });
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") return json(res, 409, { error: "insufficient_stock" });
    if (error instanceof Error && error.message === "INVENTORY_CONFLICT") return json(res, 409, { error: "inventory_conflict" });
    if (error instanceof Error && error.message === "IDEMPOTENCY_KEY_REUSED") return json(res, 409, { error: "idempotency_key_reused", message: "This idempotency key was already used for a different checkout." });
    return json(res, 500, { error: "internal_error" });
  }
};
