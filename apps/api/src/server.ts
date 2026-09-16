import { createServer } from "node:http";
import { prisma } from "@commerceos/database";
import { handleRequest } from "./routes.js";
import { handleInventoryRequest } from "./inventory.js";
import { handleOrderStatusRequest } from "./order-status.js";

const port = Number(process.env.PORT ?? 4000);

const server = createServer(async (req, res) => {
  if ((req.url ?? "/").startsWith("/inventory")) {
    const handled = await handleInventoryRequest(req, res);
    if (handled) return;
  }
  if ((req.url ?? "/").match(/^\/orders\/[^/]+\/status$/)) {
    const handled = await handleOrderStatusRequest(req, res);
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
