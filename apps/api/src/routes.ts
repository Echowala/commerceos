import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { createToken, hashPassword } from "./auth.js";
import { signup } from "./signup.js";
import { getRequestContext, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
const body = async (req: IncomingMessage) => { let raw = ""; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {}; };
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN ?? "http://localhost:3000");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return json(res, 204, null);
  try {
    if (req.url === "/health" && req.method === "GET") return json(res, 200, { name: "CommerceOS API", status: "ok" });
    if (req.url === "/ready" && req.method === "GET") { await prisma.$queryRaw`SELECT 1`; return json(res, 200, { status: "ready", database: "ok" }); }
    if (req.url === "/auth/signup" && req.method === "POST") return json(res, 201, await signup(await body(req)));
    if (req.url === "/auth/dev-login" && req.method === "POST") { const input = await body(req); const user = await prisma.user.findFirst({ where: { email: String(input.email ?? "").trim().toLowerCase(), tenantId: input.tenantId } }); if (!user || user.passwordHash !== hashPassword(String(input.password ?? ""))) return json(res, 401, { error: "invalid_credentials" }); return json(res, 200, { token: createToken({ userId: user.id, tenantId: user.tenantId, role: user.role }) }); }
    const context = getRequestContext(req.headers); const tenantId = requireTenant(context);
    if (req.url === "/me" && req.method === "GET") { const user = await prisma.user.findFirst({ where: { id: context.auth!.userId, tenantId }, select: { id: true, email: true, name: true, role: true, tenant: { select: { id: true, name: true, slug: true } } } }); return user ? json(res, 200, user) : json(res, 404, { error: "user_not_found" }); }
    if (req.url === "/dashboard" && req.method === "GET") { const [stores, products, orders, customers, revenue] = await Promise.all([prisma.store.count({ where: { tenantId } }), prisma.product.count({ where: { store: { tenantId }, status: "ACTIVE" } }), prisma.order.count({ where: { tenantId } }), prisma.customer.count({ where: { tenantId } }), prisma.order.aggregate({ where: { tenantId, paymentStatus: "PAID" }, _sum: { total: true } })]); return json(res, 200, { stores, products, orders, customers, revenue: revenue._sum.total?.toString() ?? "0" }); }
    if (req.url === "/stores" && req.method === "GET") return json(res, 200, await prisma.store.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }));
    if (req.url === "/stores" && req.method === "POST") { const input = await body(req); if (!input.name) return json(res, 400, { error: "name is required" }); const slug = slugify(input.slug ?? input.name); if (!slug) return json(res, 400, { error: "valid slug is required" }); return json(res, 201, await prisma.store.create({ data: { tenantId, name: input.name, slug, currency: input.currency ?? "PKR" } })); }
    if (req.url === "/products" && req.method === "GET") return json(res, 200, await prisma.product.findMany({ where: { store: { tenantId } }, include: { variants: true }, orderBy: { createdAt: "desc" } }));
    if (req.url === "/products" && req.method === "POST") { const input = await body(req); if (!input.storeId || !input.name || !input.variant?.sku || input.variant?.price == null) return json(res, 400, { error: "storeId, name and variant sku/price are required" }); const store = await prisma.store.findFirst({ where: { id: input.storeId, tenantId } }); if (!store) return json(res, 404, { error: "store_not_found" }); const slug = slugify(input.slug ?? input.name); if (!slug) return json(res, 400, { error: "valid slug is required" }); return json(res, 201, await prisma.product.create({ data: { storeId: store.id, name: input.name, slug, description: input.description, status: input.status ?? "DRAFT", variants: { create: { sku: input.variant.sku, price: input.variant.price, stock: input.variant.stock ?? 0 } } }, include: { variants: true } })); }
    return json(res, 404, { error: "not_found" });
  } catch (error) { if (error instanceof Error && error.message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" }); if (error instanceof SyntaxError) return json(res, 400, { error: "invalid_json" }); console.error(error); return json(res, 500, { error: "internal_server_error" }); }
};
