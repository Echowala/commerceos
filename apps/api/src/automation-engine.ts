import { prisma } from "@commerceos/database";
import type { Prisma } from "@prisma/client";

export type AutomationEvent = {
  tenantId: string;
  trigger: "ORDER_PLACED" | "ORDER_STATUS_CHANGED" | "CUSTOMER_CREATED" | "INVENTORY_LOW";
  customerId?: string | null;
  data: Record<string, unknown>;
};

type Condition = { field?: unknown; operator?: unknown; value?: unknown };

type Action = { type: string; tagId?: string; note?: string; url?: string };

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const getPath = (data: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((value, key) => asRecord(value)[key], data);

const matchesCondition = (data: Record<string, unknown>, condition: Condition): boolean => {
  if (typeof condition.field !== "string" || typeof condition.operator !== "string") return false;
  const actual = getPath(data, condition.field);
  const expected = condition.value;
  switch (condition.operator) {
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    case "gt": return Number(actual) > Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "contains": return typeof actual === "string" && actual.toLowerCase().includes(String(expected).toLowerCase());
    default: return false;
  }
};

const matchesConditions = (data: Record<string, unknown>, conditions: unknown): boolean => {
  const root = asRecord(conditions);
  const all = Array.isArray(root.all) ? root.all : [];
  const any = Array.isArray(root.any) ? root.any : [];
  if (all.length && !all.every(item => matchesCondition(data, asRecord(item)))) return false;
  if (any.length && !any.some(item => matchesCondition(data, asRecord(item)))) return false;
  return true;
};

const executeAction = async (tx: Prisma.TransactionClient, tenantId: string, customerId: string | null | undefined, action: Action, event: AutomationEvent) => {
  if (action.type === "ADD_CUSTOMER_TAG") {
    if (!customerId || !action.tagId) return;
    const tag = await tx.customerTag.findFirst({ where: { id: action.tagId, tenantId }, select: { id: true } });
    if (!tag) throw new Error("AUTOMATION_TAG_NOT_FOUND");
    await tx.customerTagAssignment.upsert({ where: { customerId_tagId: { customerId, tagId: tag.id } }, create: { customerId, tagId: tag.id }, update: {} });
    return;
  }
  if (action.type === "CREATE_CUSTOMER_NOTE") {
    if (!customerId || !action.note) return;
    await tx.customerEvent.create({ data: { tenantId, customerId, type: "NOTE", data: { note: action.note, source: "automation" } } });
    return;
  }
  if (action.type === "SEND_WEBHOOK") {
    if (!action.url || !/^https:\/\//i.test(action.url)) throw new Error("AUTOMATION_WEBHOOK_URL_INVALID");
    // External delivery is intentionally not performed inside the DB transaction.
    return;
  }
  throw new Error("AUTOMATION_ACTION_UNSUPPORTED");
};

export const triggerAutomations = async (event: AutomationEvent): Promise<void> => {
  const automations = await prisma.automation.findMany({ where: { tenantId: event.tenantId, trigger: event.trigger, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  for (const automation of automations) {
    const startedAt = new Date();
    try {
      if (!matchesConditions(event.data, automation.conditions)) continue;
      const actions = Array.isArray(automation.actions) ? automation.actions as Action[] : [];
      await prisma.$transaction(async tx => {
        for (const action of actions) await executeAction(tx, event.tenantId, event.customerId, action, event);
        await tx.automationExecution.create({ data: { tenantId: event.tenantId, automationId: automation.id, status: "SUCCEEDED", startedAt, finishedAt: new Date(), input: event.data as Prisma.InputJsonValue, output: { actionCount: actions.length } } });
      });
    } catch (error) {
      await prisma.automationExecution.create({ data: { tenantId: event.tenantId, automationId: automation.id, status: "FAILED", startedAt, finishedAt: new Date(), input: event.data as Prisma.InputJsonValue, error: error instanceof Error ? error.message : "automation_failed" } });
    }
  }
};
