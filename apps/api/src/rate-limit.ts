import type { IncomingMessage, ServerResponse } from "node:http";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const PUBLIC_CHECKOUT_MAX = 20;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const getClientKey = (req: IncomingMessage) => {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress ?? "unknown";
  return ip;
};

const consume = (key: string, limit: number, now = Date.now()) => {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS };
  }
  existing.count += 1;
  return { allowed: existing.count <= limit, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
};

export const rateLimit = (req: IncomingMessage, res: ServerResponse, scope: "api" | "public-checkout") => {
  const limit = scope === "public-checkout" ? PUBLIC_CHECKOUT_MAX : MAX_REQUESTS;
  const result = consume(`${scope}:${getClientKey(req)}`, limit);
  res.setHeader("x-ratelimit-limit", String(limit));
  res.setHeader("x-ratelimit-remaining", String(result.remaining));
  res.setHeader("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) {
    res.setHeader("retry-after", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
    res.statusCode = 429;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "rate_limited" }));
    return false;
  }
  return true;
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, WINDOW_MS).unref();
