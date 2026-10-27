import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@commerceos/database";
import { createToken } from "./auth.js";
import { handleRequest } from "./routes.js";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantId = `staff-role-${suffix}`;

const withServer = async (run: (baseUrl: string) => Promise<void>) => {
  const server = createServer(handleRequest);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
};

describe("database-backed staff role boundaries", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("allows ordinary tenant reads but denies webhook administration to STAFF", async () => {
    await prisma.tenant.create({
      data: { id: tenantId, name: "Staff Role Tenant", slug: `staff-role-${suffix}` },
    });
    const user = await prisma.user.create({
      data: {
        id: `staff-user-${suffix}`,
        tenantId,
        email: `staff-${suffix}@example.test`,
        passwordHash: "test-only-hash",
        role: "STAFF",
      },
    });
    const store = await prisma.store.create({
      data: { tenantId, name: "Staff visible store", slug: `staff-store-${suffix}` },
    });
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        tenantId,
        name: "Staff protected endpoint",
        url: "https://staff.example.test/webhook",
        secret: "test-secret",
        events: ["ORDER_PLACED"],
      },
    });
    const token = createToken({
      userId: user.id,
      tenantId,
      role: "STAFF",
      sessionVersion: user.sessionVersion,
    });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    await withServer(async baseUrl => {
      const storesResponse = await fetch(`${baseUrl}/stores`, { headers });
      assert.equal(storesResponse.status, 200);
      assert.deepEqual((await storesResponse.json() as Array<{ id: string }>).map(item => item.id), [store.id]);

      const deniedRequests: Array<[string, RequestInit]> = [
        ["/webhooks", { headers }],
        ["/webhooks/deliveries", { headers }],
        ["/webhooks", { method: "POST", headers, body: JSON.stringify({ name: "new", url: "https://new.example.test", secret: "secret", events: ["ORDER_PLACED"] }) }],
        [`/webhooks/${endpoint.id}`, { method: "PATCH", headers, body: JSON.stringify({ name: "changed" }) }],
        [`/webhooks/${endpoint.id}`, { method: "DELETE", headers }],
        [`/webhooks/${endpoint.id}/test`, { method: "POST", headers }],
      ];

      for (const [path, init] of deniedRequests) {
        const response = await fetch(`${baseUrl}${path}`, init);
        assert.equal(response.status, 403, `${init.method ?? "GET"} ${path}`);
        assert.deepEqual(await response.json(), { error: "forbidden" }, `${init.method ?? "GET"} ${path}`);
      }

      const endpointAfter = await prisma.webhookEndpoint.findUnique({ where: { id: endpoint.id } });
      assert.equal(endpointAfter?.name, "Staff protected endpoint");
    });
  });
});
