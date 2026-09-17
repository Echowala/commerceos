import { createServer } from "node:http";
import { prisma } from "@commerceos/database";
import { handleRequest } from "./routes.js";
import { handleInventoryRequest } from "./inventory.js";
import { handleOrderStatusRequest } from "./order-status.js";
import { handleCustomersRequest } from "./customers.js";
import { handleCrmRequest } from "./crm.js";
import { handleSegmentsRequest } from "./segments.js";
import { handleAutomationRequest } from "./automation.js";
import { rateLimit } from "./rate-limit.js";

const port = Number(process.env.PORT ?? 4000);

const server = createServer(async (req, res) => {
  const isPublicCheckout = (req.url ?? "/").match(/^\/public\/stores\/[^/]+\/[^/]+\/orders$/) && req.method === "POST";
  if (!rateLimit(req, res, isPublicCheckout ? "public-checkout" : "api")) return;

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
