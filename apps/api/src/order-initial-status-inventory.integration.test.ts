import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@commerceos/database";
import { createToken } from "./auth.js";
import { handleRequest } from "./routes.js";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantId = `order-status-${suffix}`;

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

describe("database-backed initial order status inventory behavior", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("deducts stock for pending orders but preserves it for initially cancelled and refunded orders", async () => {
    await prisma.tenant.create({
      data: { id: tenantId, name: "Order Status Tenant", slug: `order-status-${suffix}` },
    });
    const user = await prisma.user.create({
      data: {
        id: `order-status-user-${suffix}`,
        tenantId,
        email: `order-status-${suffix}@example.test`,
        passwordHash: "test-only-hash",
        role: "OWNER",
      },
    });
    const store = await prisma.store.create({
      data: { tenantId, name: "Order Status Store", slug: `order-status-store-${suffix}` },
    });
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name: "Order Status Product",
        slug: `order-status-product-${suffix}`,
        status: "ACTIVE",
        variants: { create: { sku: `order-status-sku-${suffix}`, price: "12.50", stock: 10 } },
      },
      include: { variants: true },
    });
    const variant = product.variants[0];
    assert.ok(variant);

    const token = createToken({
      userId: user.id,
      tenantId,
      role: "OWNER",
      sessionVersion: user.sessionVersion,
    });
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    await withServer(async baseUrl => {
      const createOrder = async (status: string | undefined, quantity: number) => {
        const response = await fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            storeId: store.id,
            ...(status === undefined ? {} : { status }),
            items: [{ variantId: variant.id, quantity }],
          }),
        });
        assert.equal(response.status, 201);
        return await response.json() as { id: string; status: string; tenantId: string };
      };

      const pending = await createOrder("PENDING", 1);
      assert.equal(pending.status, "PENDING");
      assert.equal(pending.tenantId, tenantId);

      const cancelled = await createOrder("CANCELLED", 2);
      assert.equal(cancelled.status, "CANCELLED");

      const refunded = await createOrder("REFUNDED", 2);
      assert.equal(refunded.status, "REFUNDED");

      const invalidStatus = await createOrder("NOT_A_REAL_STATUS", 1);
      assert.equal(invalidStatus.status, "PENDING", "unsupported statuses should fall back to PENDING");

      const [savedVariant, orders, saleMovements] = await Promise.all([
        prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
        prisma.order.findMany({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true },
        }),
        prisma.inventoryMovement.findMany({
          where: { tenantId, type: "SALE" },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      assert.equal(savedVariant.stock, 8, "only the two PENDING orders should consume stock");
      assert.deepEqual(orders.map(order => order.status), ["PENDING", "CANCELLED", "REFUNDED", "PENDING"]);
      assert.equal(saleMovements.length, 2, "only stock-consuming orders should create SALE movements");
      assert.deepEqual(saleMovements.map(movement => movement.quantity), [-1, -1]);
      assert.deepEqual(saleMovements.map(movement => movement.stockBefore), [10, 9]);
      assert.deepEqual(saleMovements.map(movement => movement.stockAfter), [9, 8]);
      assert.deepEqual(
        saleMovements.map(movement => movement.referenceId),
        [pending.id, invalidStatus.id],
      );
    });
  });
});
