import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@commerceos/database";
import { getRequestContext, requireRole, requireTenant } from "./tenant.js";
import { audit } from "./audit.js";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const body = async (req: IncomingMessage) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length > 1_000_000) throw new Error("PAYLOAD_TOO_LARGE");
  return raw ? JSON.parse(raw) : {};
};

const paymentStatuses = ["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
type PaymentStatus = (typeof paymentStatuses)[number];

const allowedTransitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["PAID", "FAILED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: ["PENDING", "PAID"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REFUNDED: [],
};

export const handlePaymentStatusRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/orders\/([^/]+)\/payment-status$/);
  if (!match || req.method !== "PATCH") return false;

  try {
    const context = await getRequestContext(req.headers);
    const tenantId = requireTenant(context);
    requireRole(context, "OWNER", "ADMIN");
    const input = await body(req);
    const status = String(input.status ?? "") as PaymentStatus;

    if (!paymentStatuses.includes(status)) {
      return json(res, 400, { error: "invalid_payment_status" }) as never;
    }

    const result = await prisma.$transaction(async tx => {
      const order = await tx.order.findFirst({
        where: { id: match[1], tenantId },
        select: { id: true, orderNumber: true, paymentStatus: true, paymentMethod: true },
      });
      if (!order) throw new Error("ORDER_NOT_FOUND");

      const current = order.paymentStatus as PaymentStatus;
      if (current === status) return { ...order, paymentStatus: current, from: current };

      if (!allowedTransitions[current].includes(status)) {
        throw new Error(`INVALID_PAYMENT_TRANSITION:${current}:${status}`);
      }

      const updated = await tx.order.updateMany({
        where: { id: order.id, tenantId, paymentStatus: current },
        data: { paymentStatus: status },
      });
      if (updated.count !== 1) throw new Error("PAYMENT_STATE_CONFLICT");

      return { ...order, paymentStatus: status, from: current };
    });

    if (result.from !== result.paymentStatus) {
      await audit(tenantId, context.auth!.userId, "PAYMENT_STATUS_CHANGED", "Order", result.id, req, {
        orderNumber: result.orderNumber,
        paymentMethod: result.paymentMethod,
        from: result.from,
        to: result.paymentStatus,
      });
    }

    return json(res, 200, {
      id: result.id,
      orderNumber: result.orderNumber,
      paymentMethod: result.paymentMethod,
      paymentStatus: result.paymentStatus,
    }) as never;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json(res, 401, { error: "unauthorized" }) as never;
    if (message === "FORBIDDEN") return json(res, 403, { error: "forbidden" }) as never;
    if (message === "PAYLOAD_TOO_LARGE") return json(res, 413, { error: "payload_too_large" }) as never;
    if (message === "ORDER_NOT_FOUND") return json(res, 404, { error: "order_not_found" }) as never;
    if (message.startsWith("INVALID_PAYMENT_TRANSITION:")) {
      const [, from, to] = message.split(":");
      return json(res, 409, { error: "invalid_payment_transition", from, to }) as never;
    }
    if (message === "PAYMENT_STATE_CONFLICT") {
      return json(res, 409, { error: "payment_state_conflict", message: "Payment status changed while this update was being processed. Please retry." }) as never;
    }
    return json(res, 500, { error: "internal_server_error" }) as never;
  }
};
