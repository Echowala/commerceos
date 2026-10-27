import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@commerceos/database";
import { createToken } from "./auth.js";
import { handleRequest } from "./routes.js";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantAId = `order-safety-a-${suffix}`;
const tenantBId = `order-safety-b-${suffix}`;
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

describe("database-backed order creation and inventory safety", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  });

  it("rejects foreign tenant references and rolls back overselling without corrupting stock", async () => {
    await prisma.tenant.createMany({
      data: [
        { id: tenantAId, name: "Order Safety Tenant A", slug: `order-safety-a-${suffix}` },
        { id: tenantBId, name: "Order Safety Tenant B", slug: `order-safety-b-${suffix}` },
      ],
    });
    const user = await prisma.user.create({
      data: {
        id: `order-safety-user-${suffix}`,
        tenantId: tenantAId,
        email: `order-safety-${suffix}@example.test`,
        passwordHash: "test-only-hash",
        role: "OWNER",
      },
    });
    const storeA = await prisma.store.create({
      data: { tenantId: tenantAId, name: "Order Safety Store A", slug: `order-safety-store-a-${suffix}` },
    });
    const storeB = await prisma.store.create({
      data: { tenantId: tenantBId, name: "Order Safety Store B", slug: `order-safety-store-b-${suffix}` },
    });
    const customerB = await prisma.customer.create({
      data: { tenantId: tenantBId, email: `foreign-customer-${suffix}@example.test`, firstName: "Foreign" },
    });
    const product = await prisma.product.create({
      data: {
        storeId: storeA.id,
        name: "Limited Stock Product",
        slug: `limited-stock-${suffix}`,
        status: "ACTIVE",
        variants: { create: { sku: `limited-stock-${suffix}`, price: "10.00", stock: 2 } },
      },
      include: { variants: true },
    });
    const variant = product.variants[0];
    assert.ok(variant);

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
      const foreignStoreResponse = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          storeId: storeB.id,
          items: [{ variantId: variant.id, quantity: 1 }],
        }),
      });
      assert.equal(foreignStoreResponse.status, 404);
      assert.deepEqual(await foreignStoreResponse.json(), { error: "store_not_found" });

      const foreignCustomerResponse = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          storeId: storeA.id,
          customerId: customerB.id,
          items: [{ variantId: variant.id, quantity: 1 }],
        }),
      });
      assert.equal(foreignCustomerResponse.status, 404);
      assert.deepEqual(await foreignCustomerResponse.json(), { error: "customer_not_found" });

      const [ordersBefore, movementsBefore] = await Promise.all([
        prisma.order.count({ where: { tenantId: tenantAId } }),
        prisma.inventoryMovement.count({ where: { tenantId: tenantAId } }),
      ]);
      const oversellResponse = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          storeId: storeA.id,
          items: [{ variantId: variant.id, quantity: 3 }],
        }),
      });
      assert.equal(oversellResponse.status, 409);
      assert.deepEqual(await oversellResponse.json(), { error: "insufficient_stock" });

      const [ordersAfterFailure, movementsAfterFailure, variantAfterFailure] = await Promise.all([
        prisma.order.count({ where: { tenantId: tenantAId } }),
        prisma.inventoryMovement.count({ where: { tenantId: tenantAId } }),
        prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
      ]);
      assert.equal(ordersAfterFailure, ordersBefore, "failed order must be rolled back");
      assert.equal(movementsAfterFailure, movementsBefore, "failed order must not leave inventory movements");
      assert.equal(variantAfterFailure.stock, 2, "failed order must not reduce stock");

      const successfulResponse = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          storeId: storeA.id,
          items: [{ variantId: variant.id, quantity: 1 }],
        }),
      });
      assert.equal(successfulResponse.status, 201);
      const createdOrder = await successfulResponse.json() as { id: string; tenantId: string; items: Array<{ variantId: string; quantity: number }> };
      assert.equal(createdOrder.tenantId, tenantAId);
      assert.equal(createdOrder.items.length, 1);
      assert.equal(createdOrder.items[0]?.variantId, variant.id);
      assert.equal(createdOrder.items[0]?.quantity, 1);

      const [variantAfterSuccess, saleMovement] = await Promise.all([
        prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
        prisma.inventoryMovement.findFirst({ where: { tenantId: tenantAId, referenceId: createdOrder.id, type: "SALE" } }),
      ]);
      assert.equal(variantAfterSuccess.stock, 1);
      assert.ok(saleMovement, "successful order must record its stock movement");
      assert.equal(saleMovement.quantity, -1);
      assert.equal(saleMovement.stockBefore, 2);
      assert.equal(saleMovement.stockAfter, 1);
    });
  });
});
