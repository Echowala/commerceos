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

describe("database-backed order status and stock semantics", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("defaults unknown statuses to PENDING and skips stock movements for CANCELLED and REFUNDED orders", async () => {
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
      const createOrder = async (status?: string) => {
        const response = await fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            storeId: store.id,
            ...(status === undefined ? {} : { status }),
            items: [{ variantId: variant.id, quantity: 1 }],
          }),
        });
        assert.equal(response.status, 201);
        return await response.json() as { id: string; status: string };
      };

      const defaultOrder = await createOrder();
      assert.equal(defaultOrder.status, "PENDING");

      const invalidStatusOrder = await createOrder("NOT_A_REAL_STATUS");
      assert.equal(invalidStatusOrder.status, "PENDING");

      const cancelledOrder = await createOrder("CANCELLED");
      assert.equal(cancelledOrder.status, "CANCELLED");

      const refundedOrder = await createOrder("REFUNDED");
      assert.equal(refundedOrder.status, "REFUNDED");

      const [updatedVariant, movements, orders] = await Promise.all([
        prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
        prisma.inventoryMovement.findMany({
          where: { tenantId, variantId: variant.id },
          orderBy: { createdAt: "asc" },
        }),
        prisma.order.findMany({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      assert.equal(updatedVariant.stock, 8, "only the two PENDING orders should decrement stock");
      assert.equal(movements.length, 2, "only stock-consuming orders should record SALE movements");
      assert.ok(movements.every(movement => movement.type === "SALE" && movement.quantity === -1));
      assert.deepEqual(
        orders.map(order => order.status),
        ["PENDING", "PENDING", "CANCELLED", "REFUNDED"],
      );
      assert.equal(orders.length, 4);
      assert.equal(orders[2]?.id, cancelledOrder.id);
      assert.equal(orders[3]?.id, refundedOrder.id);
    });
  });
});
