import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@commerceos/database";
import { createToken } from "./auth.js";
import { handleRequest } from "./routes.js";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantAId = `mutation-a-${suffix}`;
const tenantBId = `mutation-b-${suffix}`;
const tenantIds = [tenantAId, tenantBId];

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

describe("database-backed cross-tenant mutation isolation", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  });

  it("rejects cross-tenant customer and product updates without changing their records", async () => {
    await prisma.tenant.createMany({
      data: [
        { id: tenantAId, name: "Mutation Tenant A", slug: `mutation-a-${suffix}` },
        { id: tenantBId, name: "Mutation Tenant B", slug: `mutation-b-${suffix}` },
      ],
    });
    const user = await prisma.user.create({
      data: {
        id: `mutation-user-a-${suffix}`,
        tenantId: tenantAId,
        email: `mutation-a-${suffix}@example.test`,
        passwordHash: "test-only-hash",
        role: "OWNER",
      },
    });
    const storeB = await prisma.store.create({
      data: { tenantId: tenantBId, name: "Protected Store", slug: `protected-store-${suffix}` },
    });
    const productB = await prisma.product.create({
      data: { storeId: storeB.id, name: "Protected Product", slug: `protected-product-${suffix}`, status: "ACTIVE" },
    });
    const customerB = await prisma.customer.create({
      data: { tenantId: tenantBId, email: `protected-${suffix}@example.test`, firstName: "Original" },
    });
    const token = createToken({
      userId: user.id,
      tenantId: tenantAId,
      role: "OWNER",
      sessionVersion: user.sessionVersion,
    });
    const authHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    await withServer(async baseUrl => {
      const customerResponse = await fetch(`${baseUrl}/customers/${customerB.id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ firstName: "Compromised" }),
      });
      assert.equal(customerResponse.status, 404);
      assert.deepEqual(await customerResponse.json(), { error: "customer_not_found" });

      const productResponse = await fetch(`${baseUrl}/products/${productB.id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ name: "Compromised Product" }),
      });
      assert.equal(productResponse.status, 404);

      const [customerAfter, productAfter] = await Promise.all([
        prisma.customer.findUniqueOrThrow({ where: { id: customerB.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: productB.id } }),
      ]);
      assert.equal(customerAfter.firstName, "Original");
      assert.equal(customerAfter.email, `protected-${suffix}@example.test`);
      assert.equal(productAfter.name, "Protected Product");
      assert.equal(productAfter.slug, `protected-product-${suffix}`);
    });
  });
});
