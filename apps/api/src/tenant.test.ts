import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToken } from "./auth.js";
import { getRequestContext, requireTenant } from "./tenant.js";

const token = (overrides: Partial<{ userId: string; tenantId: string; role: "OWNER" | "ADMIN" | "STAFF"; sessionVersion: number }> = {}) =>
  createToken({
    userId: "user-a",
    tenantId: "tenant-a",
    role: "ADMIN",
    sessionVersion: 2,
    ...overrides,
  });

const matchingUser = { role: "ADMIN" as const, sessionVersion: 2 };

describe("tenant request context", () => {
  it("binds the context to the tenant in the signed token and matching database user", async () => {
    const context = await getRequestContext(
      { authorization: `Bearer ${token()}` },
      async (userId, tenantId) => {
        assert.equal(userId, "user-a");
        assert.equal(tenantId, "tenant-a");
        return matchingUser;
      },
    );

    assert.equal(context.tenantId, "tenant-a");
    assert.equal(context.auth?.userId, "user-a");
    assert.equal(requireTenant(context), "tenant-a");
  });

  it("rejects a user lookup that does not exist in the token tenant", async () => {
    const context = await getRequestContext(
      { authorization: `Bearer ${token()}` },
      async (_userId, tenantId) => tenantId === "tenant-b" ? matchingUser : null,
    );

    assert.deepEqual(context, { auth: null, tenantId: null });
    assert.throws(() => requireTenant(context), /UNAUTHORIZED/);
  });

  it("rejects role changes after a token was issued", async () => {
    const context = await getRequestContext(
      { authorization: `Bearer ${token()}` },
      async () => ({ role: "STAFF", sessionVersion: 2 }),
    );

    assert.deepEqual(context, { auth: null, tenantId: null });
  });

  it("rejects revoked sessions after the session version changes", async () => {
    const context = await getRequestContext(
      { authorization: `Bearer ${token()}` },
      async () => ({ role: "ADMIN", sessionVersion: 3 }),
    );

    assert.deepEqual(context, { auth: null, tenantId: null });
  });

  it("does not query the database for missing or malformed bearer tokens", async () => {
    let lookups = 0;
    const lookup = async () => {
      lookups += 1;
      return matchingUser;
    };

    assert.deepEqual(await getRequestContext({}, lookup), { auth: null, tenantId: null });
    assert.deepEqual(await getRequestContext({ authorization: "Basic abc" }, lookup), { auth: null, tenantId: null });
    assert.equal(lookups, 0);
  });
});
