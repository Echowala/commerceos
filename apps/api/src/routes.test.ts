import { createServer, type AddressInfo } from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./routes.js";

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

describe("API HTTP route integration", () => {
  it("serves health checks with JSON and security headers", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { name: "CommerceOS API", status: "ok" });
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    });
  });

  it("answers CORS preflight without requiring authentication", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/dashboard`, {
        method: "OPTIONS",
        headers: { origin: "https://store.example", "access-control-request-method": "GET" },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
      assert.equal(response.headers.get("access-control-allow-headers"), "content-type, authorization, idempotency-key");
    });
  });

  it("rejects protected routes without a valid authenticated tenant", async () => {
    await withServer(async baseUrl => {
      for (const authorization of [undefined, "Bearer malformed.token.structure"]) {
        const response = await fetch(`${baseUrl}/dashboard`, {
          headers: authorization ? { authorization } : {},
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "unauthorized" });
      }
    });
  });

  it("returns a client error for malformed JSON instead of an internal error", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_json" });
    });
  });
});
