import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { createToken, hashPassword } from "./auth.js";
import { signup } from "./signup.js";
import { getRequestContext, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
const body = async (req: IncomingMessage) => { let raw = ""; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {}; };

export const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.url === "/health" && req.method === "GET") return json(res, 200, { name: "CommerceOS API", status: "ok" });
    if (req.url === "/ready" && req.method === "GET") { await prisma.$queryRaw`SELECT 1`; return json(res, 200, { status: "ready", database: "ok" }); }
    if (req.url === "/auth/signup" && req.method === "POST") return json(res, 201, await signup(await body(req)));
    if (req.url === "/auth/dev-login" && req.method === "POST") {
      const input = await body(req);
      const user = await prisma.user.findFirst({ where: { email: String(input.email ?? "").trim().toLowerCase(), tenantId: input.tenantId } });
      if (!user || user.passwordHash !== hashPassword(String(input.password ?? ""))) return json(res, 401, { error: "invalid_credentials" });
      return json(res, 200, { token: createToken({ userId: user.id, tenantId: user.tenantId, role: user.role }) });
    }
    const tenantId = requireTenant(getRequestContext(req.headers));
    if (req.url === "/stores" && req.method === "GET") return json(res, 200, await prisma.store.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }));
    if (req.url === "/stores" && req.method === "POST") { const input = await body(req); if (!input.name || !input.slug) return json(res, 400, { error: "name and slug are required" }); return json(res, 201, await prisma.store.create({ data: { tenantId, name: input.name, slug: input.slug, currency: input.currency ?? "PKR" } })); }
    if (req.url === "/products" && req.method === "GET") return json(res, 200, await prisma.product.findMany({ where: { store: { tenantId } }, include: { variants: true }, orderBy: { createdAt: "desc" } }));
    if (req.url === "/products" && req.method === "POST") { const input = await body(req); if (!input.storeId || !input.name || !input.slug || !input.variant?.sku || input.variant?.price == null) return json(res, 400, { error: "storeId, name, slug and variant sku/price are required" }); const store = await prisma.store.findFirst({ where: { id: input.storeId, tenantId } }); if (!store) return json(res, 404, { error: "store_not_found" }); return json(res, 201, await prisma.product.create({ data: { storeId: store.id, name: input.name, slug: input.slug, description: input.description, status: input.status ?? "DRAFT", variants: { create: { sku: input.variant.sku, price: input.variant.price, stock: input.variant.stock ?? 0 } } }, include: { variants: true } })); }
    return json(res, 404, { error: "not_found" });
  } catch (error) { if (error instanceof Error && error.message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" }); if (error instanceof SyntaxError) return json(res, 400, { error: "invalid_json" }); console.error(error); return json(res, 500, { error: "internal_server_error" }); }
};
