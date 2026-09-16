import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import type { Prisma } from "@prisma/client";
import { getRequestContext, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
};

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length > 100_000) throw new Error("PAYLOAD_TOO_LARGE");
  const value: unknown = raw ? JSON.parse(raw) : {};
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

type Rule = { field: "orderCount" | "totalSpend" | "lastOrderDaysAgo" | "tag"; operator: "gte" | "lte" | "eq" | "neq" | "gt" | "lt"; value: string | number };
type SegmentRules = { match: "all" | "any"; rules: Rule[] };
type CustomerForSegment = { id: string; orders: { total: unknown; status: string; createdAt: Date }[]; tags: { tag: { name: string } }[] };

const fields = new Set<string>(["orderCount", "totalSpend", "lastOrderDaysAgo", "tag"]);
const operators = new Set<string>(["gte", "lte", "eq", "neq", "gt", "lt"]);

const validRules = (value: unknown): value is SegmentRules => {
  if (!value || typeof value !== "object") return false;
  const input = value as { match?: unknown; rules?: unknown };
  if (input.match !== "all" && input.match !== "any") return false;
  if (!Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > 10) return false;
  return input.rules.every((rule: unknown): boolean => {
    if (!rule || typeof rule !== "object") return false;
    const item = rule as Record<string, unknown>;
    const field = String(item.field);
    const operator = String(item.operator);
    if (!fields.has(field) || !operators.has(operator)) return false;
    if (field === "tag") {
      return (operator === "eq" || operator === "neq") && typeof item.value === "string" && item.value.trim().length > 0 && item.value.trim().length <= 80;
    }
    const n = Number(item.value);
    return Number.isFinite(n) && n >= 0;
  });
};

const matches = (rules: SegmentRules, customer: CustomerForSegment): boolean => {
  const validOrders = customer.orders.filter(order => order.status !== "CANCELLED" && order.status !== "REFUNDED");
  const spend = validOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const lastOrder = customer.orders[0]?.createdAt ?? null;
  const lastOrderDaysAgo = lastOrder ? Math.max(0, (Date.now() - lastOrder.getTime()) / 86_400_000) : null;
  const evaluate = (rule: Rule): boolean => {
    if (rule.field === "tag") {
      const hasTag = customer.tags.some(({ tag }) => tag.name.toLowerCase() === String(rule.value).trim().toLowerCase());
      return rule.operator === "eq" ? hasTag : !hasTag;
    }
    const actual = rule.field === "orderCount" ? validOrders.length : rule.field === "totalSpend" ? spend : lastOrderDaysAgo;
    if (actual === null) return false;
    const expected = Number(rule.value);
    if (rule.operator === "gte") return actual >= expected;
    if (rule.operator === "lte") return actual <= expected;
    if (rule.operator === "gt") return actual > expected;
    if (rule.operator === "lt") return actual < expected;
    if (rule.operator === "eq") return actual === expected;
    return actual !== expected;
  };
  return rules.match === "all" ? rules.rules.every(evaluate) : rules.rules.some(evaluate);
};

const parseRules = (value: Prisma.JsonValue): SegmentRules | null => validRules(value) ? value : null;

export const handleSegmentsRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/crm/segments")) return false;
  try {
    const context = getRequestContext(req.headers);
    const tenantId = requireTenant(context);

    if (url.pathname === "/crm/segments" && req.method === "GET") {
      const segments = await prisma.customerSegment.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
      const customers = await prisma.customer.findMany({ where: { tenantId }, select: { id: true, orders: { select: { total: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 }, tags: { select: { tag: { select: { name: true } } } } } });
      return json(res, 200, segments.map(segment => {
        const rules = parseRules(segment.rules);
        return { ...segment, customerCount: rules ? customers.filter(customer => matches(rules, customer)).length : 0 };
      }));
    }

    if (url.pathname === "/crm/segments" && req.method === "POST") {
      const input = await readBody(req);
      const name = String(input.name ?? "").trim();
      const description = input.description == null ? null : String(input.description).trim() || null;
      if (!name || name.length > 100) return json(res, 400, { error: "segment_name_required" });
      if (!validRules(input.rules)) return json(res, 400, { error: "invalid_segment_rules" });
      const existing = await prisma.customerSegment.findFirst({ where: { tenantId, name }, select: { id: true } });
      if (existing) return json(res, 409, { error: "segment_already_exists" });
      return json(res, 201, await prisma.customerSegment.create({ data: { tenantId, name, description, rules: input.rules } }));
    }

    const match = url.pathname.match(/^\/crm\/segments\/([^/]+)$/);
    if (match && req.method === "DELETE") {
      const deleted = await prisma.customerSegment.deleteMany({ where: { id: match[1], tenantId } });
      return deleted.count ? json(res, 204, null) : json(res, 404, { error: "segment_not_found" });
    }

    const members = url.pathname.match(/^\/crm\/segments\/([^/]+)\/customers$/);
    if (members && req.method === "GET") {
      const segment = await prisma.customerSegment.findFirst({ where: { id: members[1], tenantId } });
      if (!segment) return json(res, 404, { error: "segment_not_found" });
      const rules = parseRules(segment.rules);
      if (!rules) return json(res, 500, { error: "invalid_segment_rules" });
      const customers = await prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, orders: { select: { total: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 }, tags: { select: { tag: { select: { name: true } } } } } });
      const result = customers.filter(customer => matches(rules, customer)).map(customer => {
        const validOrders = customer.orders.filter(order => order.status !== "CANCELLED" && order.status !== "REFUNDED");
        return { id: customer.id, email: customer.email, phone: customer.phone, firstName: customer.firstName, lastName: customer.lastName, orderCount: validOrders.length, totalSpend: validOrders.reduce((sum, order) => sum + Number(order.total), 0).toFixed(2), lastOrderAt: customer.orders[0]?.createdAt?.toISOString() ?? null, tags: customer.tags.map(({ tag }) => tag.name) };
      });
      return json(res, 200, result);
    }

    return json(res, 404, { error: "segment_route_not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" });
    if (message === "PAYLOAD_TOO_LARGE") return json(res, 413, { error: "payload_too_large" });
    return json(res, 500, { error: "internal_server_error" });
  }
};
