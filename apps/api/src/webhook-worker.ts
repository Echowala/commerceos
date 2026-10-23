import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { prisma } from "@commerceos/database";

export const MAX_ATTEMPTS = 5;
export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
const STALE_DELIVERY_MS = 15 * 60 * 1000;
const POLL_MS = 1_000;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];

export const getWebhookRetryDelay = (attempt: number) =>
  RETRY_DELAYS_MS[Math.max(0, Math.floor(attempt) - 1)] ?? 3_600_000;

const signPayload = (secret: string, payload: string) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

const nextRetry = (attempt: number, now: () => Date = () => new Date()) => new Date(now().getTime() + getWebhookRetryDelay(attempt));

export type WebhookWorkerDependencies = {
  db?: typeof prisma;
  fetchImpl?: typeof fetch;
  validateTarget?: typeof validateWebhookTarget;
  now?: () => Date;
};

const isPrivateAddress = (address: string) => {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    // Only accept IPv6 global-unicast space (2000::/3), excluding documentation
    // space. This also rejects multicast, unspecified, and other special-use ranges.
    return !/^[23]/.test(normalized) ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("::ffff:");
  }
  return true;
};

export const validateWebhookTarget = async (rawUrl: string) => {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Invalid webhook URL");
  }
  if (target.protocol !== "https:" || target.username || target.password) {
    throw new Error("Webhook URL must be HTTPS without embedded credentials");
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Webhook target host is not allowed");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Webhook target must resolve only to public IP addresses");
  }
  return target.toString();
};

export const deliverWebhook = async (deliveryId: string, dependencies: WebhookWorkerDependencies = {}) => {
  const db = dependencies.db ?? prisma;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const validateTarget = dependencies.validateTarget ?? validateWebhookTarget;
  const now = dependencies.now ?? (() => new Date());
  // Atomic claim prevents two queue workers from sending the same queued delivery.
  const claimed = await db.webhookDelivery.updateMany({
    where: { id: deliveryId, status: "QUEUED", availableAt: { lte: now() } },
    data: { status: "DELIVERING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;

  const delivery = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) return null;

  const attempt = delivery.attempts;
  const attemptStartedAt = now();
  const attemptRecord = await db.webhookDeliveryAttempt.create({
    data: { deliveryId: delivery.id, attemptNumber: attempt, status: "IN_PROGRESS", startedAt: attemptStartedAt },
  });
  let httpStatus: number | null = null;
  try {
    const target = await validateTarget(delivery.endpoint.url);
    const payload = JSON.stringify(delivery.payload);
    // Do not follow redirects: they could redirect an approved URL to a private host.
    const response = await fetchImpl(target, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-commerceos-event": delivery.eventType,
        "x-commerceos-event-id": delivery.eventId,
        "x-commerceos-signature": `sha256=${signPayload(delivery.endpoint.secret, payload)}`,
      },
      body: payload,
      signal: AbortSignal.timeout(WEBHOOK_REQUEST_TIMEOUT_MS),
    });

    httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Webhook responded with HTTP ${response.status}`);
    }
    await response.body?.cancel().catch(() => undefined);

    const finishedAt = now();
    await db.webhookDeliveryAttempt.update({
      where: { id: attemptRecord.id },
      data: { status: "SUCCEEDED", httpStatus, finishedAt, durationMs: Math.max(0, finishedAt.getTime() - attemptStartedAt.getTime()) },
    });
    return await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", deliveredAt: finishedAt, availableAt: finishedAt, lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook delivery failed";
    const terminal = attempt >= MAX_ATTEMPTS;
    const finishedAt = now();
    await db.webhookDeliveryAttempt.update({
      where: { id: attemptRecord.id },
      data: { status: "FAILED", httpStatus, error: message, finishedAt, durationMs: Math.max(0, finishedAt.getTime() - attemptStartedAt.getTime()) },
    });
    return await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: terminal ? "FAILED" : "QUEUED",
        availableAt: terminal ? finishedAt : nextRetry(attempt, () => finishedAt),
        lastError: message,
      },
    });
  }
};

export const recoverStuckWebhookDeliveries = async (staleAfterMs = STALE_DELIVERY_MS, dependencies: WebhookWorkerDependencies = {}) => {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? (() => new Date());
  const staleBefore = new Date(now().getTime() - Math.max(60_000, staleAfterMs));
  const staleDeliveries = await db.webhookDelivery.findMany({
    where: { status: "DELIVERING", updatedAt: { lte: staleBefore } },
    select: { id: true, attempts: true, updatedAt: true },
    take: 100,
    orderBy: { updatedAt: "asc" },
  });
  let recovered = 0;
  for (const delivery of staleDeliveries) {
    const terminal = delivery.attempts >= MAX_ATTEMPTS;
    const result = await db.webhookDelivery.updateMany({
      where: { id: delivery.id, status: "DELIVERING", updatedAt: delivery.updatedAt },
      data: {
        status: terminal ? "FAILED" : "QUEUED",
        availableAt: now(),
        lastError: "Recovered stale delivery after worker interruption",
      },
    });
    if (result.count === 1) {
      await db.webhookDeliveryAttempt.updateMany({
        where: { deliveryId: delivery.id, attemptNumber: delivery.attempts, status: "IN_PROGRESS" },
        data: { status: "INTERRUPTED", error: "Worker interrupted before attempt completed", finishedAt: now() },
      });
    }
    recovered += result.count;
  }
  return recovered;
};

export const processWebhookQueue = async (limit = 25) => {
  await recoverStuckWebhookDeliveries();
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { status: "QUEUED", availableAt: { lte: new Date() }, endpoint: { is: { status: "ACTIVE" } } },
    orderBy: { createdAt: "asc" },
    take: Math.min(100, Math.max(1, Math.floor(limit))),
    select: { id: true },
  });
  return Promise.all(deliveries.map(({ id }) => deliverWebhook(id)));
};


export const startWebhookWorker = (): (() => Promise<void>) => {
  let stopped = false;
  let active: Promise<unknown> | null = null;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped) return;
    active = processWebhookQueue().catch(error => {
      console.error("Webhook worker error", error);
    });
    await active;
    active = null;
    if (!stopped) {
      timer = setTimeout(() => void tick(), POLL_MS);
      timer.unref();
    }
  };
  void tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (active) await active;
  };
};
