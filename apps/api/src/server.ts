import { createServer } from "node:http";
import { prisma } from "@commerceos/database";

const port = Number(process.env.PORT ?? 4000);

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    return json(res, 200, { name: "CommerceOS API", status: "ok" });
  }

  if (req.url === "/ready" && req.method === "GET") {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return json(res, 200, { status: "ready", database: "ok" });
    } catch {
      return json(res, 503, { status: "not_ready", database: "unavailable" });
    }
  }

  return json(res, 404, { error: "not_found" });
});

server.listen(port, () => console.log(`CommerceOS API listening on :${port}`));

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
