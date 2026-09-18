import { prisma } from "@commerceos/database";
import type { Prisma } from "@prisma/client";

export type AutomationEvent = {
  tenantId: string;
  trigger: "ORDER_PLACED" | "ORDER_STATUS_CHANGED" | "CUSTOMER_CREATED" | "INVENTORY_LOW";
  customerId?: string | null;
  eventId?: string;
  data: Record<string, unknown>;
};

type Condition = { field?: unknown; operator?: unknown; value?: unknown };
type Action = { type: string; tagId?: string; note?: string; url?: string };

const WEBHOOK_TIMEOUT_MS = 10_000;
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

const executeDatabaseAction = async (tx: Prisma.TransactionClient, tenantId: string, customerId: string | null | undefined, action: Action) => {
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
  if (action.type === "SEND_WEBHOOK") return;
  throw new Error("AUTOMATION_ACTION_UNSUPPORTED");
};

const sendWebhook = async (tenantId: string, trigger: AutomationEvent["trigger"], eventId: string | undefined, action: Action, event: AutomationEvent) => {
  if (!action.url || !/^https:\/\//i.test(action.url)) throw new Error("AUTOMATION_WEBHOOK_URL_INVALID");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(action.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-commerceos-event": trigger, ...(eventId ? { "x-commerceos-event-id": eventId } : {}) },
      body: JSON.stringify({ trigger, eventId: eventId ?? null, tenantId, customerId: event.customerId ?? null, data: event.data }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AUTOMATION_WEBHOOK_HTTP_${response.status}`);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("AUTOMATION_WEBHOOK_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const triggerAutomations = async (event: AutomationEvent): Promise<void> => {
  const automations = await prisma.automation.findMany({ where: { tenantId: event.tenantId, trigger: event.trigger, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  for (const automation of automations) {
    const startedAt = new Date();
    try {
      if (!matchesConditions(event.data, automation.conditions)) continue;
      const actions = Array.isArray(automation.actions) ? automation.actions as Action[] : [];
      if (event.eventId) {
        const existing = await prisma.automationExecution.findFirst({ where: { automationId: automation.id, triggerEventId: event.eventId }, select: { id: true } });
        if (existing) continue;
      }
      const databaseActions = actions.filter(action => action.type !== "SEND_WEBHOOK");
      const webhookActions = actions.filter(action => action.type === "SEND_WEBHOOK");
      if (webhookActions.some(action => !action.url || !/^https:\/\//i.test(action.url))) throw new Error("AUTOMATION_WEBHOOK_URL_INVALID");

      let executionId: string;
      try {
        const execution = await prisma.automationExecution.create({
          data: {
            tenantId: event.tenantId,
            automationId: automation.id,
            triggerEventId: event.eventId,
            status: "RUNNING",
            startedAt,
            input: { ...event.data, eventId: event.eventId ?? null } as Prisma.InputJsonValue,
            output: { databaseActionCount: databaseActions.length, webhookActionCount: webhookActions.length },
          },
          select: { id: true },
        });
        executionId = execution.id;
      } catch (error) {
        // The unique (automationId, triggerEventId) constraint is the authoritative
        // idempotency guard. Under a race, one invocation owns the execution and the
        // other must leave it untouched rather than marking it failed.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && event.eventId) continue;
        throw error;
      }

      try {
        await prisma.$transaction(async tx => {
          for (const action of databaseActions) await executeDatabaseAction(tx, event.tenantId, event.customerId, action);
        });

        for (const action of webhookActions) await sendWebhook(event.tenantId, event.trigger, event.eventId, action, event);

        await prisma.automationExecution.updateMany({
          where: { id: executionId },
          data: {
            status: "SUCCEEDED",
            finishedAt: new Date(),
            output: { actionCount: actions.length, databaseActionCount: databaseActions.length, webhookActionCount: webhookActions.length },
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "automation_failed";
        await prisma.automationExecution.updateMany({
          where: { id: executionId, status: "RUNNING" },
          data: { status: "FAILED", finishedAt: new Date(), error: message },
        });
      }
    }
  }
};
