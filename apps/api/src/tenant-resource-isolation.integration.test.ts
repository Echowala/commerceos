import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@commerceos/database";
import { createToken } from "./auth.js";
import { handleRequest } from "./routes.js";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantAId = `tenant-a-${suffix}`;
const tenantBId = `tenant-b-${suffix}`;
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

describe("database-backed tenant resource isolation", { skip: !databaseConfigured }, () => {
  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  });

  it("lists only the authenticated tenant's webhooks and denies foreign resource IDs", async () => {
    await prisma.tenant.createMany({
      data: [
        { id: tenantAId, name: "Tenant A", slug: `tenant-a-${suffix}` },
        { id: tenantBId, name: "Tenant B", slug: `tenant-b-${suffix}` },
      ],
    });
    const user = await prisma.user.create({
      data: {
        id: `user-a-${suffix}`,
        tenantId: tenantAId,
        email: `tenant-a-${suffix}@example.test`,
        passwordHash: "test-only-hash",
        role: "OWNER",
      },
    });
    const endpointA = await prisma.webhookEndpoint.create({
      data: {
        tenantId: tenantAId,
        name: "A endpoint",
        url: "https://a.example.test/webhook",
        secret: "test-secret-a",
        events: ["ORDER_PLACED"],
      },
    });
    const endpointB = await prisma.webhookEndpoint.create({
      data: {
        tenantId: tenantBId,
        name: "B endpoint",
        url: "https://b.example.test/webhook",
        secret: "test-secret-b",
        events: ["ORDER_PLACED"],
      },
    });
    const deliveryA = await prisma.webhookDelivery.create({
      data: {
        tenantId: tenantAId,
        endpointId: endpointA.id,
        eventId: `event-a-${suffix}`,
        eventType: "ORDER_PLACED",
        payload: { tenant: "A" },
      },
    });
    const deliveryB = await prisma.webhookDelivery.create({
      data: {
        tenantId: tenantBId,
        endpointId: endpointB.id,
        eventId: `event-b-${suffix}`,
        eventType: "ORDER_PLACED",
        payload: { tenant: "B" },
      },
    });
    const token = createToken({
      userId: user.id,
      tenantId: tenantAId,
      role: "OWNER",
      sessionVersion: user.sessionVersion,
    });

    await withServer(async baseUrl => {
      const webhooks = await fetch(`${baseUrl}/webhooks`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(webhooks.status, 200);
      const webhookItems = await webhooks.json() as Array<{ id: string; name: string }>;
      assert.deepEqual(webhookItems.map(item => item.id), [endpointA.id]);
      assert.equal(webhookItems.some(item => item.name === "B endpoint"), false);

      const deliveries = await fetch(`${baseUrl}/webhooks/deliveries`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(deliveries.status, 200);
      const deliveryBody = await deliveries.json() as { items: Array<{ id: string; tenantId?: string }> };
      assert.deepEqual(deliveryBody.items.map(item => item.id), [deliveryA.id]);
      assert.equal(deliveryBody.items.some(item => item.id === deliveryB.id), false);

      const foreignWebhookTest = await fetch(`${baseUrl}/webhooks/${endpointB.id}/test`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(foreignWebhookTest.status, 404);
      assert.deepEqual(await foreignWebhookTest.json(), { error: "webhook_not_found" });

      const foreignReplay = await fetch(`${baseUrl}/webhooks/deliveries/${deliveryB.id}/replay`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(foreignReplay.status, 404);
      assert.deepEqual(await foreignReplay.json(), { error: "webhook_delivery_not_found" });
    });
  });
});
