import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { webhookTenantScope } from "./webhook-tenant-scope.js";

describe("webhook tenant-scoped resource lookup", () => {
  it("requires both the requested resource ID and authenticated tenant ID", () => {
    assert.deepEqual(webhookTenantScope("delivery-a", "tenant-a"), {
      id: "delivery-a",
      tenantId: "tenant-a",
    });
    assert.notDeepEqual(webhookTenantScope("delivery-a", "tenant-a"), {
      id: "delivery-a",
      tenantId: "tenant-b",
    });
  });

  it("does not treat a matching resource ID as sufficient without tenant scope", () => {
    const requested = webhookTenantScope("endpoint-shared-id", "tenant-a");
    const foreignTenantRecord = { id: "endpoint-shared-id", tenantId: "tenant-b" };
    const matches = requested.id === foreignTenantRecord.id && requested.tenantId === foreignTenantRecord.tenantId;
    assert.equal(matches, false);
  });
});
