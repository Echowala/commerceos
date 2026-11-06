import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@commerceos/database";
import { handleRequest } from "./routes.js";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantId = `public-checkout-idem-${suffix}`;
const invalidTenantId = `public-checkout-invalid-${suffix}`;
const invalidTenantSlug = `public-checkout-invalid-${suffix}`;
const tenantSlug = `public-checkout-idem-${suffix}`;
const storeSlug = `public-checkout-store-${suffix}`;

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

describe("database-backed public checkout idempotency", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, invalidTenantId] } } });
  });

  it("replays the original order and rejects reuse of a key for a different checkout", async () => {
    await prisma.tenant.create({
      data: { id: tenantId, name: "Public Checkout Idempotency", slug: tenantSlug },
    });
    const store = await prisma.store.create({
      data: { tenantId, name: "Public Checkout Store", slug: storeSlug },
    });
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name: "Idempotent Checkout Product",
        slug: `idempotent-product-${suffix}`,
        status: "ACTIVE",
        variants: { create: { sku: `idempotent-sku-${suffix}`, price: "15.00", stock: 10 } },
      },
      include: { variants: true },
    });
    const variant = product.variants[0];
    assert.ok(variant);

    const key = `checkout-idem-${suffix}`.padEnd(24, "x");
    const payload = {
      customer: { email: `buyer-${suffix}@example.test`, name: "Checkout Buyer", phone: "03001234567", address: "10 Main Street" },
      items: [{ variantId: variant.id, quantity: 2 }],
      paymentMethod: "COD",
    };

    await withServer(async baseUrl => {
      const submit = (body: typeof payload, idempotencyKey = key) => fetch(
        `${baseUrl}/public/stores/${tenantSlug}/${storeSlug}/orders`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify(body),
        },
      );

      const first = await submit(payload);
      assert.equal(first.status, 201);
      const firstOrder = await first.json() as { orderNumber: string; total: string; status: string };

      const replay = await submit(payload);
      assert.equal(replay.status, 200);
      const replayOrder = await replay.json() as typeof firstOrder;
      assert.deepEqual(replayOrder, firstOrder, "retry must return the original order result");

      const changedPayload = {
        ...payload,
        items: [{ variantId: variant.id, quantity: 3 }],
      };
      const conflict = await submit(changedPayload);
      assert.equal(conflict.status, 409);
      assert.deepEqual(await conflict.json(), {
        error: "idempotency_key_reused",
        message: "This idempotency key was already used for a different checkout.",
      });

      const [savedVariant, orders, movements] = await Promise.all([
        prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
        prisma.order.findMany({ where: { storeId: store.id } }),
        prisma.inventoryMovement.findMany({ where: { tenantId, type: "SALE" } }),
      ]);
      assert.equal(savedVariant.stock, 8, "a replay or conflicting retry must not consume stock again");
      assert.equal(orders.length, 1);
      assert.equal(movements.length, 1);
      assert.equal(movements[0]?.quantity, -2);

      const concurrentKey = `checkout-concurrent-${suffix}`.padEnd(24, "x");
      const concurrentPayload = {
        ...payload,
        items: [{ variantId: variant.id, quantity: 1 }],
      };
      const concurrentResponses = await Promise.all([
        submit(concurrentPayload, concurrentKey),
        submit(concurrentPayload, concurrentKey),
      ]);
      assert.deepEqual(
        concurrentResponses.map(response => response.status).sort((a, b) => a - b),
        [200, 201],
        "simultaneous requests with the same key should create once and replay once",
      );
      const concurrentOrders = await Promise.all(concurrentResponses.map(response => response.json())) as typeof firstOrder[];
      assert.deepEqual(concurrentOrders[0], concurrentOrders[1], "both concurrent callers must receive the same order");

      const [stockAfterConcurrent, ordersAfterConcurrent, movementsAfterConcurrent] = await Promise.all([
        prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
        prisma.order.findMany({ where: { storeId: store.id } }),
        prisma.inventoryMovement.findMany({ where: { tenantId, type: "SALE" } }),
      ]);
      assert.equal(stockAfterConcurrent.stock, 7, "concurrent replay must decrement stock only once");
      assert.equal(ordersAfterConcurrent.length, 2, "concurrent replay must create only one additional order");
      assert.equal(movementsAfterConcurrent.length, 2, "concurrent replay must create only one additional SALE movement");
      assert.equal(movementsAfterConcurrent.reduce((total, movement) => total + movement.quantity, 0), -3);

      const conflictingConcurrentKey = `checkout-race-conflict-${suffix}`.padEnd(32, "x");
      const conflictingPayload = {
        ...payload,
        items: [{ variantId: variant.id, quantity: 2 }],
      };
      const matchingPayload = {
        ...payload,
        items: [{ variantId: variant.id, quantity: 1 }],
      };
      const beforeConflictRace = await prisma.order.count({ where: { storeId: store.id } });
      const conflictRaceResponses = await Promise.all([
        submit(matchingPayload, conflictingConcurrentKey),
        submit(conflictingPayload, conflictingConcurrentKey),
      ]);
      assert.deepEqual(
        conflictRaceResponses.map(response => response.status).sort((a, b) => a - b),
        [201, 409],
        "simultaneous requests reusing a key for different carts must create once and reject once",
      );
      const conflictRaceBodies = await Promise.all(conflictRaceResponses.map(response => response.json())) as Array<Record<string, unknown>>;
      const createdResult = conflictRaceBodies[conflictRaceResponses.findIndex(response => response.status === 201)];
      const rejectedResult = conflictRaceBodies[conflictRaceResponses.findIndex(response => response.status === 409)];
      assert.ok(createdResult?.orderNumber, "the winning request should receive the created order");
      const winningTotal = Number(createdResult.total);
      assert.ok(Number.isFinite(winningTotal), "the winning request should return its order total");
      assert.deepEqual(rejectedResult, {
        error: "idempotency_key_reused",
        message: "This idempotency key was already used for a different checkout.",
      });
      const [ordersAfterConflictRace, movementsAfterConflictRace] = await Promise.all([
        prisma.order.findMany({ where: { storeId: store.id } }),
        prisma.inventoryMovement.findMany({ where: { tenantId, type: "SALE" } }),
      ]);
      assert.equal(ordersAfterConflictRace.length, beforeConflictRace + 1, "conflicting concurrent retry must create only one order");
      assert.equal(movementsAfterConflictRace.length, 3, "conflicting concurrent retry must create only one SALE movement");
      assert.equal(
        movementsAfterConflictRace.reduce((total, movement) => total + movement.quantity, 0),
        -3 - winningTotal / 15,
        "only the winning checkout may consume stock",
      );
    });
  });

  it("rejects malformed idempotency keys before creating an order", async () => {
    await prisma.tenant.create({
      data: { id: invalidTenantId, name: "Public Checkout Invalid Key", slug: invalidTenantSlug },
    });
    const store = await prisma.store.create({
      data: { tenantId: invalidTenantId, name: "Invalid Key Store", slug: `invalid-key-store-${suffix}` },
    });
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name: "Invalid Key Product",
        slug: `invalid-key-product-${suffix}`,
        status: "ACTIVE",
        variants: { create: { sku: `invalid-key-sku-${suffix}`, price: "5.00", stock: 5 } },
      },
      include: { variants: true },
    });
    const variant = product.variants[0];
    assert.ok(variant);

    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/public/stores/${invalidTenantSlug}/${store.slug}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "short" },
        body: JSON.stringify({
          customer: { email: `invalid-${suffix}@example.test`, name: "Buyer", phone: "03000000000", address: "Address" },
          items: [{ variantId: variant.id, quantity: 1 }],
        }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_idempotency_key" });
      assert.equal(await prisma.order.count({ where: { storeId: store.id } }), 0);
      assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock, 5);
    });
  });
});
