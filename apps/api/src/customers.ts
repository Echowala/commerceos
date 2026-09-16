import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { getRequestContext, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const money = (value: unknown) => Number(value ?? 0).toFixed(2);
const spendStatuses = { not: ["CANCELLED", "REFUNDED"] as const };

export const handleCustomersRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/customers")) return false;

  try {
    const context = getRequestContext(req.headers);
    const tenantId = requireTenant(context);

    if (url.pathname === "/customers" && req.method === "GET") {
      const customers = await prisma.customer.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, phone: true, firstName: true, lastName: true, createdAt: true, updatedAt: true },
      });
      const customerIds = customers.map(customer => customer.id);
      const orders = customerIds.length === 0 ? [] : await prisma.order.findMany({
        where: { tenantId, customerId: { in: customerIds } },
        select: { customerId: true, total: true, createdAt: true, status: true },
        orderBy: { createdAt: "desc" },
      });

      const metrics = new Map<string, { orderCount: number; totalSpend: number; lastOrderAt: Date | null }>();
      for (const order of orders) {
        if (!order.customerId) continue;
        const current = metrics.get(order.customerId) ?? { orderCount: 0, totalSpend: 0, lastOrderAt: null };
        current.orderCount += 1;
        if (!spendStatuses.not.includes(order.status)) current.totalSpend += Number(order.total);
        if (!current.lastOrderAt || order.createdAt > current.lastOrderAt) current.lastOrderAt = order.createdAt;
        metrics.set(order.customerId, current);
      }

      return json(res, 200, customers.map(customer => {
        const metric = metrics.get(customer.id) ?? { orderCount: 0, totalSpend: 0, lastOrderAt: null };
        return { ...customer, orderCount: metric.orderCount, totalSpend: money(metric.totalSpend), lastOrderAt: metric.lastOrderAt?.toISOString() ?? null };
      }));
    }

    const match = url.pathname.match(/^\/customers\/([^/]+)$/);
    if (match && req.method === "GET") {
      const customer = await prisma.customer.findFirst({
        where: { id: match[1], tenantId },
        select: {
          id: true, email: true, phone: true, firstName: true, lastName: true, createdAt: true, updatedAt: true,
          orders: {
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            select: {
              id: true, orderNumber: true, status: true, paymentStatus: true, total: true, currency: true, createdAt: true,
              store: { select: { id: true, name: true } },
              items: { select: { id: true, name: true, quantity: true, unitPrice: true, total: true }, orderBy: { name: "asc" } },
            },
          },
        },
      });
      if (!customer) return json(res, 404, { error: "customer_not_found" });

      const includedOrders = customer.orders.filter(order => !spendStatuses.not.includes(order.status));
      const totalSpend = includedOrders.reduce((sum, order) => sum + Number(order.total), 0);
      const averageOrderValue = includedOrders.length ? totalSpend / includedOrders.length : 0;
      const productCounts = new Map<string, { name: string; quantity: number }>();
      for (const order of includedOrders) {
        for (const item of order.items) {
          const current = productCounts.get(item.name) ?? { name: item.name, quantity: 0 };
          current.quantity += item.quantity;
          productCounts.set(item.name, current);
        }
      }
      const topProducts = [...productCounts.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 5);
      const lastOrderAt = customer.orders[0]?.createdAt ?? null;

      return json(res, 200, {
        ...customer,
        orderCount: customer.orders.length,
        totalSpend: money(totalSpend),
        averageOrderValue: money(averageOrderValue),
        lastOrderAt: lastOrderAt?.toISOString() ?? null,
        topProducts,
        orders: customer.orders.map(order => ({
          ...order,
          total: order.total.toString(),
          createdAt: order.createdAt.toISOString(),
          items: order.items.map(item => ({ ...item, unitPrice: item.unitPrice.toString(), total: item.total.toString() })),
        })),
      });
    }

    return json(res, 404, { error: "customer_route_not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" });
    return json(res, 500, { error: "internal_server_error" });
  }
};
