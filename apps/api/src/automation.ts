import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import type { Prisma } from "@prisma/client";
import { getRequestContext, requireTenant } from "./tenant.js";

const json = (res: ServerResponse, status: number, data: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (status === 204) { res.end(); return; }
  res.end(JSON.stringify(data));
};
const respond = (res: ServerResponse, status: number, data: unknown): true => { json(res, status, data); return true; };
const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length > 100_000) throw new Error("PAYLOAD_TOO_LARGE");
  const value: unknown = raw ? JSON.parse(raw) : {};
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

type AutomationTrigger = "ORDER_PLACED" | "ORDER_STATUS_CHANGED" | "CUSTOMER_CREATED" | "INVENTORY_LOW";
type AutomationStatus = "DRAFT" | "ACTIVE" | "PAUSED";

const triggers = new Set<AutomationTrigger>(["ORDER_PLACED", "ORDER_STATUS_CHANGED", "CUSTOMER_CREATED", "INVENTORY_LOW"]);
const statuses = new Set<AutomationStatus>(["DRAFT", "ACTIVE", "PAUSED"]);
const actionTypes = new Set(["ADD_CUSTOMER_TAG", "CREATE_CUSTOMER_NOTE", "SEND_WEBHOOK"]);

const validConfig = (value: unknown): value is Record<string, unknown>[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const action = item as Record<string, unknown>;
    if (typeof action.type !== "string" || !actionTypes.has(action.type)) return false;
    if (action.type === "ADD_CUSTOMER_TAG") return typeof action.tagId === "string" && action.tagId.trim().length > 0;
    if (action.type === "CREATE_CUSTOMER_NOTE") return typeof action.note === "string" && action.note.trim().length > 0 && action.note.trim().length <= 2000;
    if (action.type === "SEND_WEBHOOK") return typeof action.url === "string" && /^https:\/\//i.test(action.url);
    return false;
  });
};

const validConditions = (value: unknown): boolean => value == null || (typeof value === "object" && !Array.isArray(value));

export const handleAutomationRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/automations")) return false;
  try {
    const tenantId = requireTenant(getRequestContext(req.headers));
    if (url.pathname === "/automations" && req.method === "GET") {
      const automations = await prisma.automation.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { executions: true } } } });
      return respond(res, 200, automations);
    }
    if (url.pathname === "/automations" && req.method === "POST") {
      const input = await readBody(req);
      const name = String(input.name ?? "").trim();
      const description = input.description == null ? null : String(input.description).trim() || null;
      const trigger = String(input.trigger ?? "") as AutomationTrigger;
      const status = input.status == null ? "DRAFT" : String(input.status) as AutomationStatus;
      if (!name || name.length > 120) return respond(res, 400, { error: "automation_name_required" });
      if (!triggers.has(trigger)) return respond(res, 400, { error: "invalid_automation_trigger" });
      if (!statuses.has(status)) return respond(res, 400, { error: "invalid_automation_status" });
      if (!validConditions(input.conditions)) return respond(res, 400, { error: "invalid_automation_conditions" });
      if (!validConfig(input.actions)) return respond(res, 400, { error: "invalid_automation_actions" });
      const existing = await prisma.automation.findFirst({ where: { tenantId, name }, select: { id: true } });
      if (existing) return respond(res, 409, { error: "automation_already_exists" });
      const automation = await prisma.automation.create({ data: { tenantId, name, description, trigger, status, conditions: (input.conditions ?? {}) as Prisma.InputJsonValue, actions: input.actions as Prisma.InputJsonValue } });
      return respond(res, 201, automation);
    }

    const match = url.pathname.match(/^\/automations\/([^/]+)$/);
    if (match && req.method === "PATCH") {
      const existing = await prisma.automation.findFirst({ where: { id: match[1], tenantId }, select: { id: true } });
      if (!existing) return respond(res, 404, { error: "automation_not_found" });
      const input = await readBody(req);
      const data: Prisma.AutomationUpdateInput = {};
      if (input.name !== undefined) { const name = String(input.name).trim(); if (!name || name.length > 120) return respond(res, 400, { error: "automation_name_required" }); data.name = name; }
      if (input.description !== undefined) data.description = input.description == null ? null : String(input.description).trim() || null;
      if (input.status !== undefined) { const status = String(input.status) as AutomationStatus; if (!statuses.has(status)) return respond(res, 400, { error: "invalid_automation_status" }); data.status = status; }
      if (input.trigger !== undefined) { const trigger = String(input.trigger) as AutomationTrigger; if (!triggers.has(trigger)) return respond(res, 400, { error: "invalid_automation_trigger" }); data.trigger = trigger; }
      if (input.conditions !== undefined) { if (!validConditions(input.conditions)) return respond(res, 400, { error: "invalid_automation_conditions" }); data.conditions = input.conditions as Prisma.InputJsonValue; }
      if (input.actions !== undefined) { if (!validConfig(input.actions)) return respond(res, 400, { error: "invalid_automation_actions" }); data.actions = input.actions as Prisma.InputJsonValue; }
      if (!Object.keys(data).length) return respond(res, 400, { error: "no_automation_fields" });
      try { return respond(res, 200, await prisma.automation.update({ where: { id: existing.id }, data })); }
      catch (error) { if (error instanceof Error && error.message.includes("Unique constraint")) return respond(res, 409, { error: "automation_already_exists" }); throw error; }
    }
    if (match && req.method === "DELETE") {
      const deleted = await prisma.automation.deleteMany({ where: { id: match[1], tenantId } });
      return deleted.count ? respond(res, 204, null) : respond(res, 404, { error: "automation_not_found" });
    }

    const executions = url.pathname.match(/^\/automations\/([^/]+)\/executions$/);
    if (executions && req.method === "GET") {
      const automation = await prisma.automation.findFirst({ where: { id: executions[1], tenantId }, select: { id: true } });
      if (!automation) return respond(res, 404, { error: "automation_not_found" });
      const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
      const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
      return respond(res, 200, await prisma.automationExecution.findMany({ where: { automationId: automation.id, tenantId }, orderBy: { startedAt: "desc" }, take: limit }));
    }
    return respond(res, 404, { error: "automation_route_not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return respond(res, 401, { error: "unauthorized" });
    if (message === "PAYLOAD_TOO_LARGE") return respond(res, 413, { error: "payload_too_large" });
    return respond(res, 500, { error: "internal_server_error" });
  }
};
