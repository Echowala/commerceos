import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { prisma } from "@commerceos/database";
import { createToken, hashPassword } from "./auth.js";
import { signup } from "./signup.js";
import { getRequestContext, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const body = async (req: IncomingMessage) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const orderNumber = () => `CO-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

export const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN ?? "http://localhost:3000");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return json(res, 204, null);

  try {
    if (req.url === "/health" && req.method === "GET") return json(res, 200, { name: "CommerceOS API", status: "ok" });
    if (req.url === "/ready" && req.method === "GET") {
      await prisma.$queryRaw`SELECT 1`;
      return json(res, 200, { status: "ready", database: "ok" });
    }
    if (req.url === "/auth/signup" && req.method === "POST") return json(res, 201, await signup(await body(req)));
    if (req.url === "/auth/dev-login" && req.method === "POST") {
      const input = await body(req);
      const user = await prisma.user.findFirst({ where: { email: String(input.email ?? "").trim().toLowerCase(), tenantId: input.tenantId } });
      if (!user || user.passwordHash !== hashPassword(String(input.password ?? ""))) return json(res, 401, { error: "invalid_credentials" });
      return json(res, 200, { token: createToken({ userId: user.id, tenantId: user.tenantId, role: user.role }) });
    }

    const context = getRequestContext(req.headers);
    const tenantId = requireTenant(context);

    if (req.url === "/me" && req.method === "GET") {
      const user = await prisma.user.findFirst({
        where: { id: context.auth!.userId, tenantId },
        select: { id: true, email: true, name: true, role: true, tenant: { select: { id: true, name: true, slug: true } } },
      });
      return user ? json(res, 200, user) : json(res, 404, { error: "user_not_found" });
    }

    if (req.url === "/dashboard" && req.method === "GET") {
      const [stores, products, orders, customers, revenue] = await Promise.all([
        prisma.store.count({ where: { tenantId } }),
        prisma.product.count({ where: { store: { tenantId }, status: "ACTIVE" } }),
        prisma.order.count({ where: { tenantId } }),
        prisma.customer.count({ where: { tenantId } }),
        prisma.order.aggregate({ where: { tenantId, paymentStatus: "PAID" }, _sum: { total: true } }),
      ]);
      return json(res, 200, { stores, products, orders, customers, revenue: revenue._sum.total?.toString() ?? "0" });
    }

    if (req.url === "/stores" && req.method === "GET") return json(res, 200, await prisma.store.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }));
    if (req.url === "/stores" && req.method === "POST") {
      const input = await body(req);
      if (!input.name) return json(res, 400, { error: "name is required" });
      const slug = slugify(input.slug ?? input.name);
      if (!slug) return json(res, 400, { error: "valid slug is required" });
      return json(res, 201, await prisma.store.create({ data: { tenantId, name: input.name, slug, currency: input.currency ?? "PKR" } }));
    }

    if (req.url === "/products" && req.method === "GET") return json(res, 200, await prisma.product.findMany({ where: { store: { tenantId } }, include: { variants: true }, orderBy: { createdAt: "desc" } }));
    if (req.url === "/products" && req.method === "POST") {
      const input = await body(req);
      if (!input.storeId || !input.name || !input.variant?.sku || input.variant?.price == null) return json(res, 400, { error: "storeId, name and variant sku/price are required" });
      const store = await prisma.store.findFirst({ where: { id: input.storeId, tenantId } });
      if (!store) return json(res, 404, { error: "store_not_found" });
      const slug = slugify(input.slug ?? input.name);
      if (!slug) return json(res, 400, { error: "valid slug is required" });
      return json(res, 201, await prisma.product.create({
        data: { storeId: store.id, name: input.name, slug, description: input.description, status: input.status ?? "DRAFT", variants: { create: { sku: input.variant.sku, price: input.variant.price, stock: input.variant.stock ?? 0 } } },
        include: { variants: true },
      }));
    }

    if (req.url === "/customers" && req.method === "GET") {
      const customers = await prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
      const result = await Promise.all(customers.map(async (customer) => {
        const stats = await prisma.order.aggregate({ where: { tenantId, customerId: customer.id }, _count: { _all: true }, _sum: { total: true } });
        return { ...customer, orderCount: stats._count._all, totalSpend: stats._sum.total?.toString() ?? "0" };
      }));
      return json(res, 200, result);
    }

    const customerMatch = req.url?.match(/^\/customers\/([^/]+)$/);
    if (customerMatch && req.method === "GET") {
      const customer = await prisma.customer.findFirst({
        where: { id: customerMatch[1], tenantId },
        include: { orders: { orderBy: { createdAt: "desc" }, include: { store: true, items: true } } },
      });
      if (!customer) return json(res, 404, { error: "customer_not_found" });
      const totalSpend = customer.orders.reduce((sum, order) => sum + Number(order.total), 0);
      return json(res, 200, { ...customer, orderCount: customer.orders.length, totalSpend: totalSpend.toFixed(2) });
    }

    if (req.url === "/customers" && req.method === "POST") {
      const input = await body(req);
      const email = input.email ? String(input.email).trim().toLowerCase() : null;
      const phone = input.phone ? String(input.phone).trim() : null;
      if (!email && !phone) return json(res, 400, { error: "email or phone is required" });
      const existing = await prisma.customer.findFirst({ where: { tenantId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
      if (existing) return json(res, 200, existing);
      return json(res, 201, await prisma.customer.create({ data: { tenantId, email, phone, firstName: input.firstName, lastName: input.lastName } }));
    }

    if (req.url === "/orders" && req.method === "GET") {
      const orders = await prisma.order.findMany({
        where: { tenantId },
        include: { customer: true, store: true, items: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return json(res, 200, orders);
    }

    if (req.url === "/orders" && req.method === "POST") {
      const input = await body(req);
      if (!input.storeId || !Array.isArray(input.items) || input.items.length === 0) return json(res, 400, { error: "storeId and at least one item are required" });
      const store = await prisma.store.findFirst({ where: { id: input.storeId, tenantId } });
      if (!store) return json(res, 404, { error: "store_not_found" });

      const created = await prisma.$transaction(async (tx) => {
        let customerId: string | undefined;
        const email = input.customer?.email ? String(input.customer.email).trim().toLowerCase() : null;
        const phone = input.customer?.phone ? String(input.customer.phone).trim() : null;
        if (input.customerId) {
          const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId } });
          if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
          customerId = customer.id;
        } else if (email || phone) {
          const customer = await tx.customer.findFirst({ where: { tenantId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
          if (customer) customerId = customer.id;
          else customerId = (await tx.customer.create({ data: { tenantId, email, phone, firstName: input.customer?.firstName, lastName: input.customer?.lastName } })).id;
        }

        const orderItems: { productId: string; variantId: string; name: string; quantity: number; unitPrice: number; total: number }[] = [];
        let subtotal = 0;
        for (const rawItem of input.items) {
          const quantity = Number(rawItem.quantity);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
          const variant = await tx.productVariant.findFirst({ where: { id: rawItem.variantId }, include: { product: { include: { store: true } } } });
          if (!variant || variant.product.store.tenantId !== tenantId || variant.product.storeId !== store.id) throw new Error("ITEM_NOT_FOUND");
          const price = Number(variant.price);
          const total = price * quantity;
          const updated = await tx.productVariant.updateMany({ where: { id: variant.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
          if (updated.count !== 1) throw new Error("INSUFFICIENT_STOCK");
          orderItems.push({ productId: variant.productId, variantId: variant.id, name: variant.product.name, quantity, unitPrice: price, total });
          subtotal += total;
        }

        return tx.order.create({
          data: { tenantId, storeId: store.id, customerId, orderNumber: orderNumber(), status: input.status ?? "CONFIRMED", paymentStatus: input.paymentStatus ?? "PENDING", subtotal, total: subtotal, currency: store.currency, items: { create: orderItems } },
          include: { customer: true, store: true, items: true },
        });
      });
      return json(res, 201, created);
    }

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" });
    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") return json(res, 404, { error: "customer_not_found" });
    if (error instanceof Error && error.message === "INVALID_QUANTITY") return json(res, 400, { error: "quantity must be a positive integer" });
    if (error instanceof Error && error.message === "ITEM_NOT_FOUND") return json(res, 404, { error: "order_item_not_found" });
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") return json(res, 409, { error: "insufficient_stock" });
    if (error instanceof SyntaxError) return json(res, 400, { error: "invalid_json" });
    console.error(error);
    return json(res, 500, { error: "internal_server_error" });
  }
};
