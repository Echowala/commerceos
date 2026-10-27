import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@commerceos/database";
import { createToken } from "./auth.js";
import { handleRequest } from "./routes.js";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantAId = `core-a-${suffix}`;
const tenantBId = `core-b-${suffix}`;
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

describe("database-backed core resource tenant isolation", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  });

  it("scopes stores, products, customers, orders, dashboard and analytics to the authenticated tenant", async () => {
    await prisma.tenant.createMany({
      data: [
        { id: tenantAId, name: "Core Tenant A", slug: `core-a-${suffix}` },
        { id: tenantBId, name: "Core Tenant B", slug: `core-b-${suffix}` },
      ],
    });
    const user = await prisma.user.create({
      data: {
        id: `core-user-a-${suffix}`,
        tenantId: tenantAId,
        email: `core-a-${suffix}@example.test`,
        passwordHash: "test-only-hash",
        role: "OWNER",
      },
    });

    const storeA = await prisma.store.create({
      data: { tenantId: tenantAId, name: "A Store", slug: `a-store-${suffix}` },
    });
    const storeB = await prisma.store.create({
      data: { tenantId: tenantBId, name: "B Store", slug: `b-store-${suffix}` },
    });
    const productA = await prisma.product.create({
      data: { storeId: storeA.id, name: "A Product", slug: `a-product-${suffix}`, status: "ACTIVE" },
    });
    const productB = await prisma.product.create({
      data: { storeId: storeB.id, name: "B Product", slug: `b-product-${suffix}`, status: "ACTIVE" },
    });
    const customerA = await prisma.customer.create({
      data: { tenantId: tenantAId, email: `a-customer-${suffix}@example.test`, firstName: "A" },
    });
    const customerB = await prisma.customer.create({
      data: { tenantId: tenantBId, email: `b-customer-${suffix}@example.test`, firstName: "B" },
    });
    const orderA = await prisma.order.create({
      data: {
        tenantId: tenantAId,
        storeId: storeA.id,
        customerId: customerA.id,
        orderNumber: `A-${suffix}`,
        subtotal: "12.50",
        total: "12.50",
        paymentStatus: "PAID",
      },
    });
    const orderB = await prisma.order.create({
      data: {
        tenantId: tenantBId,
        storeId: storeB.id,
        customerId: customerB.id,
        orderNumber: `B-${suffix}`,
        subtotal: "99.00",
        total: "99.00",
        paymentStatus: "PAID",
      },
    });
    const token = createToken({
      userId: user.id,
      tenantId: tenantAId,
      role: "OWNER",
      sessionVersion: user.sessionVersion,
    });
    const authHeaders = { authorization: `Bearer ${token}` };

    await withServer(async baseUrl => {
      const storesResponse = await fetch(`${baseUrl}/stores`, { headers: authHeaders });
      assert.equal(storesResponse.status, 200);
      const stores = await storesResponse.json() as Array<{ id: string }>;
      assert.deepEqual(stores.map(item => item.id), [storeA.id]);

      const productsResponse = await fetch(`${baseUrl}/products`, { headers: authHeaders });
      assert.equal(productsResponse.status, 200);
      const products = await productsResponse.json() as { items: Array<{ id: string }>; total: number };
      assert.deepEqual(products.items.map(item => item.id), [productA.id]);
      assert.equal(products.total, 1);

      const customersResponse = await fetch(`${baseUrl}/customers`, { headers: authHeaders });
      assert.equal(customersResponse.status, 200);
      const customers = await customersResponse.json() as Array<{ id: string }>;
      assert.deepEqual(customers.map(item => item.id), [customerA.id]);

      const ordersResponse = await fetch(`${baseUrl}/orders`, { headers: authHeaders });
      assert.equal(ordersResponse.status, 200);
      const orders = await ordersResponse.json() as { items: Array<{ id: string }>; total: number };
      assert.deepEqual(orders.items.map(item => item.id), [orderA.id]);
      assert.equal(orders.total, 1);

      const dashboardResponse = await fetch(`${baseUrl}/dashboard`, { headers: authHeaders });
      assert.equal(dashboardResponse.status, 200);
      assert.deepEqual(await dashboardResponse.json(), {
        stores: 1,
        products: 1,
        orders: 1,
        customers: 1,
        revenue: "12.5",
      });

      const analyticsResponse = await fetch(`${baseUrl}/analytics`, { headers: authHeaders });
      assert.equal(analyticsResponse.status, 200);
      const analytics = await analyticsResponse.json() as { summary: { orders: number; customers: number; revenue: string }; topProducts: unknown[] };
      assert.deepEqual(analytics.summary, { orders: 1, customers: 1, revenue: "12.50" });
      assert.deepEqual(analytics.topProducts, []);

      for (const [path, error] of [
        [`/stores/${storeB.id}`, "store_not_found"],
        [`/products/${productB.id}`, "product_not_found"],
        [`/customers/${customerB.id}`, "customer_not_found"],
        [`/orders/${orderB.id}`, "order_not_found"],
      ] as const) {
        const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders });
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error }, path);
      }
    });
  });
});
