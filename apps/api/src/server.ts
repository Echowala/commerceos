import { createServer } from "node:http";
import { prisma } from "@commerceos/database";
import { handleRequest } from "./routes.js";

const port = Number(process.env.PORT ?? 4000);

const server = createServer(handleRequest);

server.listen(port, () => console.log(`CommerceOS API listening on :${port}`));

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
