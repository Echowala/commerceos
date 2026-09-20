import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { getRequestContext, requireRole, requireTenant } from "./tenant.js";
import { audit } from "./audit.js";

const json = (res: ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
const body = async (req: IncomingMessage) => { let raw = ""; for await (const chunk of req) raw += chunk; if (raw.length > 1_000_000) throw new Error("PAYLOAD_TOO_LARGE"); return raw ? JSON.parse(raw) : {}; };

export const handleCrmRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/crm/")) return false;
  try {
    const context = await getRequestContext(req.headers); const tenantId = requireTenant(context);

    if (url.pathname === "/crm/tags" && req.method === "GET") {
      return json(res, 200, await prisma.customerTag.findMany({ where: { tenantId }, include: { _count: { select: { customers: true } } }, orderBy: { name: "asc" } })) as never;
    }
    if (url.pathname === "/crm/tags" && req.method === "POST") { requireRole(context, "OWNER", "ADMIN");
      const input = await body(req); const name = String(input.name ?? "").trim(); const color = input.color == null ? null : String(input.color).trim() || null;
      if (!name || name.length > 80) return json(res, 400, { error: "tag_name_required" }) as never;
      const existing = await prisma.customerTag.findFirst({ where: { tenantId, name } }); if (existing) return json(res, 409, { error: "tag_already_exists" }) as never;
      const tag = await prisma.customerTag.create({ data: { tenantId, name, color } });
      await audit(tenantId, context.auth!.userId, "CRM_TAG_CREATED", "CustomerTag", tag.id, req, { name: tag.name });
      return json(res, 201, tag) as never;
    }

    const customerTags = url.pathname.match(/^\/crm\/customers\/([^/]+)\/tags$/);
    if (customerTags && req.method === "GET") {
      const customer = await prisma.customer.findFirst({ where: { id: customerTags[1], tenantId }, select: { id: true } }); if (!customer) return json(res, 404, { error: "customer_not_found" }) as never;
      return json(res, 200, await prisma.customerTagAssignment.findMany({ where: { customerId: customer.id }, include: { tag: true }, orderBy: { createdAt: "asc" } })) as never;
    }
    if (customerTags && req.method === "POST") {
      const customerId = customerTags[1]; const input = await body(req); const tagId = String(input.tagId ?? "").trim();
      const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } }); if (!customer) return json(res, 404, { error: "customer_not_found" }) as never;
      const tag = await prisma.customerTag.findFirst({ where: { id: tagId, tenantId }, select: { id: true } }); if (!tag) return json(res, 404, { error: "tag_not_found" }) as never;
      await prisma.customerTagAssignment.upsert({ where: { customerId_tagId: { customerId, tagId } }, create: { customerId, tagId }, update: {} });
      return json(res, 201, { customerId, tagId }) as never;
    }
    if (customerTags && req.method === "DELETE") {
      const customerId = customerTags[1]; const tagId = String(url.searchParams.get("tagId") ?? "").trim(); if (!tagId) return json(res, 400, { error: "tagId is required" }) as never;
      const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } }); if (!customer) return json(res, 404, { error: "customer_not_found" }) as never;
      const deleted = await prisma.customerTagAssignment.deleteMany({ where: { customerId, tagId, tag: { tenantId } } });
      if (deleted.count) await audit(tenantId, context.auth!.userId, "CRM_TAG_REMOVED", "Customer", customerId, req, { tagId });
      return json(res, 204, null) as never;
    }

    const customerEvents = url.pathname.match(/^\/crm\/customers\/([^/]+)\/events$/);
    if (customerEvents && req.method === "GET") {
      const customer = await prisma.customer.findFirst({ where: { id: customerEvents[1], tenantId }, select: { id: true } }); if (!customer) return json(res, 404, { error: "customer_not_found" }) as never;
      const requestedLimit = Number(url.searchParams.get("limit") ?? 50); const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
      return json(res, 200, await prisma.customerEvent.findMany({ where: { customerId: customer.id, tenantId }, orderBy: { createdAt: "desc" }, take: limit })) as never;
    }
    if (customerEvents && req.method === "POST") {
      const customerId = customerEvents[1]; const input = await body(req); const note = String(input.note ?? "").trim();
      if (!note || note.length > 2000) return json(res, 400, { error: "note_required" }) as never;
      const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } }); if (!customer) return json(res, 404, { error: "customer_not_found" }) as never;
      const event = await prisma.customerEvent.create({ data: { tenantId, customerId, type: "NOTE", data: { note, createdByUserId: context.auth?.userId ?? null } } });
      await audit(tenantId, context.auth!.userId, "CRM_NOTE_CREATED", "Customer", customerId, req, { eventId: event.id });
      return json(res, 201, event) as never;
    }
    return json(res, 404, { error: "crm_route_not_found" }) as never;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" }) as never;
    if (message === "PAYLOAD_TOO_LARGE") return json(res, 413, { error: "payload_too_large" }) as never;
    return json(res, 500, { error: "internal_server_error" }) as never;
  }
};
