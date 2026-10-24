import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToken, verifyToken } from "./auth.js";

const validClaims = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "OWNER" as const,
  sessionVersion: 0,
};

describe("authentication token validation", () => {
  it("accepts a correctly signed token with valid claims", () => {
    const token = createToken(validClaims);
    assert.deepEqual(verifyToken(token), {
      ...validClaims,
      exp: JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).exp,
    });
  });

  it("rejects tokens with extra segments or invalid signatures", () => {
    const token = createToken(validClaims);
    assert.equal(verifyToken(token + ".extra"), null);
    assert.equal(verifyToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a")), null);
    assert.equal(verifyToken(""), null);
  });

  it("rejects expired tokens", () => {
    assert.equal(verifyToken(createToken(validClaims, -1)), null);
  });

  it("rejects signed tokens with missing identity or invalid role claims", () => {
    const missingIdentity = createToken({ ...validClaims, userId: "" });
    const invalidRole = createToken({ ...validClaims, role: "SUPERADMIN" } as never);
    assert.equal(verifyToken(missingIdentity), null);
    assert.equal(verifyToken(invalidRole), null);
  });

  it("rejects negative or non-integer session versions", () => {
    const negative = createToken({ ...validClaims, sessionVersion: -1 });
    const fractional = createToken({ ...validClaims, sessionVersion: 1.5 });
    assert.equal(verifyToken(negative), null);
    assert.equal(verifyToken(fractional), null);
  });
});
