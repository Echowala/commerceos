import { createServer } from "node:http";
import { prisma } from "@commerceos/database";
import { handleRequest } from "./routes.js";
import { handleInventoryRequest } from "./inventory.js";

const port = Number(process.env.PORT ?? 4000);

const server = createServer(async (req, res) => {
  if ((req.url ?? "/").startsWith("/inventory")) {
    const handled = await handleInventoryRequest(req, res);
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
