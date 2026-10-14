import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { prisma } from "@commerceos/database";

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];

const signPayload = (secret: string, payload: string) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

const nextRetry = (attempt: number) =>
  new Date(Date.now() + (RETRY_DELAYS_MS[Math.max(0, attempt - 1)] ?? 3_600_000));

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
    return normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:");
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

export const deliverWebhook = async (deliveryId: string) => {
  // Atomic claim prevents two queue workers from sending the same queued delivery.
  const claimed = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: "QUEUED", availableAt: { lte: new Date() } },
    data: { status: "DELIVERING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) return null;

  const attempt = delivery.attempts;
  try {
    const target = await validateWebhookTarget(delivery.endpoint.url);
    const payload = JSON.stringify(delivery.payload);
    // Do not follow redirects: they could redirect an approved URL to a private host.
    const response = await fetch(target, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-commerceos-event": delivery.eventType,
        "x-commerceos-event-id": delivery.eventId,
        "x-commerceos-signature": `sha256=${signPayload(delivery.endpoint.secret, payload)}`,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) throw new Error(`Webhook responded with HTTP ${response.status}`);

    return await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", deliveredAt: new Date(), availableAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook delivery failed";
    const terminal = attempt >= MAX_ATTEMPTS;
    return await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: terminal ? "FAILED" : "QUEUED",
        availableAt: terminal ? new Date() : nextRetry(attempt),
        lastError: message,
      },
    });
  }
};

export const processWebhookQueue = async (limit = 25) => {
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { status: "QUEUED", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: Math.min(100, Math.max(1, Math.floor(limit))),
    select: { id: true },
  });
  return Promise.all(deliveries.map(({ id }) => deliverWebhook(id)));
};
