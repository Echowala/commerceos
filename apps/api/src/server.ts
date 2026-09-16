import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4000);

createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ name: "CommerceOS API", status: "ok" }));
}).listen(port, () => console.log(`CommerceOS API listening on :${port}`));
