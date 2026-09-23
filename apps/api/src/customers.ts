import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { getRequestContext, requireRole, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const respond = (res: ServerResponse, status: number, body: unknown): true => {
  json(res, status, body);
  return true;
};

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length > 100_000) throw new Error("PAYLOAD_TOO_LARGE");
  const value: unknown = raw ? JSON.parse(raw) : {};
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

const money = (value: unknown): string => Number(value ?? 0).toFixed(2);
const isExcludedSpendStatus = (status: string): boolean => status === "CANCELLED" || status === "REFUNDED";
const normalizeOptional = (value: unknown): string | null => {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

export const handleCustomersRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/customers")) return false;

  try {
    const context = await getRequestContext(req.headers);
    const tenantId = requireTenant(context);

    if (url.pathname === "/customers" && req.method === "GET") {
      const requestedPage = Number(url.searchParams.get("page") ?? "1");
      const requestedPageSize = Number(url.searchParams.get("pageSize") ?? "25");
      const page = Number.isInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, 10_000)) : 1;
      const pageSize = Number.isInteger(requestedPageSize) ? Math.max(1, Math.min(requestedPageSize, 100)) : 25;
      const [total, customers] = await Promise.all([
        prisma.customer.count({ where: { tenantId } }),
        prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, email: true, phone: true, firstName: true, lastName: true, createdAt: true, updatedAt: true } })
      ]);
      const customerIds = customers.map(customer => customer.id);
      const orders = customerIds.length === 0 ? [] : await prisma.order.findMany({ where: { tenantId, customerId: { in: customerIds } }, select: { customerId: true, total: true, createdAt: true, status: true }, orderBy: { createdAt: "desc" } });
      const metrics = new Map<string, { orderCount: number; totalSpend: number; lastOrderAt: Date | null }>();
      for (const order of orders) {
        if (!order.customerId) continue;
        const current = metrics.get(order.customerId) ?? { orderCount: 0, totalSpend: 0, lastOrderAt: null };
        current.orderCount += 1;
        if (!isExcludedSpendStatus(String(order.status))) current.totalSpend += Number(order.total);
        if (!current.lastOrderAt || order.createdAt > current.lastOrderAt) current.lastOrderAt = order.createdAt;
        metrics.set(order.customerId, current);
      }
      return respond(res, 200, {
        items: customers.map(customer => {
          const metric = metrics.get(customer.id) ?? { orderCount: 0, totalSpend: 0, lastOrderAt: null };
          return { ...customer, orderCount: metric.orderCount, totalSpend: money(metric.totalSpend), lastOrderAt: metric.lastOrderAt?.toISOString() ?? null };
        }),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      });
    }

    const match = url.pathname.match(/^\/customers\/([^/]+)$/);
    if (match && req.method === "PATCH") {
      requireRole(context, "OWNER", "ADMIN");
      const existing = await prisma.customer.findFirst({ where: { id: match[1], tenantId }, select: { id: true } });
      if (!existing) return respond(res, 404, { error: "customer_not_found" });
      const input = await readBody(req);
      const data: { email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null } = {};
      if (input.email !== undefined) {
        const email = normalizeOptional(input.email)?.toLowerCase() ?? null;
        if (email && (!email.includes("@") || email.length > 320)) return respond(res, 400, { error: "invalid_email" });
        data.email = email;
      }
      if (input.phone !== undefined) {
        const phone = normalizeOptional(input.phone);
        if (phone && phone.length > 40) return respond(res, 400, { error: "invalid_phone" });
        data.phone = phone;
      }
      if (input.firstName !== undefined) {
        const firstName = normalizeOptional(input.firstName);
        if (firstName && firstName.length > 120) return respond(res, 400, { error: "invalid_first_name" });
        data.firstName = firstName;
      }
      if (input.lastName !== undefined) {
        const lastName = normalizeOptional(input.lastName);
        if (lastName && lastName.length > 120) return respond(res, 400, { error: "invalid_last_name" });
        data.lastName = lastName;
      }
      if (Object.keys(data).length === 0) return respond(res, 400, { error: "no_customer_fields" });
      if (data.email === null && data.phone === null) return respond(res, 400, { error: "email_or_phone_required" });
      if (data.email) {
        const duplicate = await prisma.customer.findFirst({ where: { tenantId, email: data.email, id: { not: existing.id } }, select: { id: true } });
        if (duplicate) return respond(res, 409, { error: "customer_email_exists" });
      }
      const updated = await prisma.customer.update({ where: { id: existing.id }, data, select: { id: true, email: true, phone: true, firstName: true, lastName: true, createdAt: true, updatedAt: true } });
      return respond(res, 200, updated);
    }

    if (match && req.method === "GET") {
      const customer = await prisma.customer.findFirst({ where: { id: match[1], tenantId }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, createdAt: true, updatedAt: true, orders: { where: { tenantId }, orderBy: { createdAt: "desc" }, select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, currency: true, createdAt: true, store: { select: { id: true, name: true } }, items: { select: { id: true, name: true, quantity: true, unitPrice: true, total: true }, orderBy: { name: "asc" } } } } } });
      if (!customer) return respond(res, 404, { error: "customer_not_found" });
      const includedOrders = customer.orders.filter(order => !isExcludedSpendStatus(String(order.status)));
      const totalSpend = includedOrders.reduce((sum, order) => sum + Number(order.total), 0);
      const averageOrderValue = includedOrders.length ? totalSpend / includedOrders.length : 0;
      const productCounts = new Map<string, { name: string; quantity: number }>();
      for (const order of includedOrders) for (const item of order.items) {
        const current = productCounts.get(item.name) ?? { name: item.name, quantity: 0 };
        current.quantity += item.quantity;
        productCounts.set(item.name, current);
      }
      const topProducts = [...productCounts.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 5);
      const lastOrderAt = customer.orders[0]?.createdAt ?? null;
      return respond(res, 200, { ...customer, orderCount: customer.orders.length, totalSpend: money(totalSpend), averageOrderValue: money(averageOrderValue), lastOrderAt: lastOrderAt?.toISOString() ?? null, topProducts, orders: customer.orders.map(order => ({ ...order, total: order.total.toString(), createdAt: order.createdAt.toISOString(), items: order.items.map(item => ({ ...item, unitPrice: item.unitPrice.toString(), total: item.total.toString() })) })) });
    }

    return respond(res, 404, { error: "customer_route_not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return respond(res, 401, { error: "unauthorized" });
    if (message === "FORBIDDEN") return respond(res, 403, { error: "forbidden" });
    if (message === "PAYLOAD_TOO_LARGE") return respond(res, 413, { error: "payload_too_large" });
    return respond(res, 500, { error: "internal_server_error" });
  }
};
