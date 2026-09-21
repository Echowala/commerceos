import { createServer } from "node:http";
import { prisma } from "@commerceos/database";
import { handleRequest } from "./routes.js";
import { handleInventoryRequest } from "./inventory.js";
import { handleOrderStatusRequest } from "./order-status.js";
import { handleCustomersRequest } from "./customers.js";
import { handleCrmRequest } from "./crm.js";
import { handleSegmentsRequest } from "./segments.js";
import { handleAutomationRequest } from "./automation.js";
import { checkRateLimitDependency, rateLimit } from "./rate-limit.js";

const port = Number(process.env.PORT ?? 4000);
const trustedProxy = process.env.TRUSTED_PROXY === "true";
const MAX_JSON_BYTES = 1_000_000;

const rejectInvalidRequest = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  if (!["POST", "PATCH", "PUT"].includes(req.method ?? "")) return false;
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_JSON_BYTES) {
    res.statusCode = 413;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "payload_too_large" }));
    return true;
  }
  const contentType = req.headers["content-type"]?.split(";")[0].trim().toLowerCase();
  if (contentType && contentType !== "application/json") {
    res.statusCode = 415;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "unsupported_media_type" }));
    return true;
  }
  return false;
};

const getClientIp = (req: import("node:http").IncomingMessage) => {
  if (trustedProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
};

const server = createServer(async (req, res) => {
  try {\n    if (rejectInvalidRequest(req, res)) return;
  const isPublicCheckout = (req.url ?? "/").match(/^\/public\/stores\/[^/]+\/[^/]+\/orders$/) && req.method === "POST";
  if (!(await rateLimit(req, res, isPublicCheckout ? "public-checkout" : "api"))) return;

  if ((req.url ?? "/").startsWith("/inventory")) {
    const handled = await handleInventoryRequest(req, res);
    if (handled) return;
  }
  if ((req.url ?? "/").match(/^\/orders\/[^/]+\/status$/)) {
    const handled = await handleOrderStatusRequest(req, res);
    if (handled) return;
  }
  if ((req.url ?? "/").startsWith("/customers")) {
    const handled = await handleCustomersRequest(req, res);
    if (handled) return;
  }
  if ((req.url ?? "/").startsWith("/automations")) {
    const handled = await handleAutomationRequest(req, res);
    if (handled) return;
  }
  if ((req.url ?? "/").startsWith("/crm/segments")) {
    const handled = await handleSegmentsRequest(req, res);
    if (handled) return;
  }
  if ((req.url ?? "/").startsWith("/crm/")) {
    const handled = await handleCrmRequest(req, res);
    if (handled) return;
  }
  return handleRequest(req, res);
});

server.listen(port, () => console.log(`CommerceOS API listening on :${port}`));

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
