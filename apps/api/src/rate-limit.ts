import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient, type RedisClientType } from "redis";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const PUBLIC_CHECKOUT_MAX = 20;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let redis: RedisClientType | null = null;
let redisConnectPromise: Promise<void> | null = null;

const getClientKey = (req: IncomingMessage) => {
  const forwarded = process.env.TRUSTED_PROXY === "true" ? req.headers["x-forwarded-for"] : undefined;
  return typeof forwarded === "string" && forwarded.trim() ? forwarded.split(",")[0].trim() : req.socket.remoteAddress ?? "unknown";
};

const getRedis = async () => {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", error => console.error("Redis rate-limit error", error));
  }
  if (!redis.isOpen) {
    redisConnectPromise ??= redis.connect().then(() => undefined).finally(() => { redisConnectPromise = null; });
    await redisConnectPromise;
  }
  return redis;
};

const consumeRedis = async (key: string, limit: number, now: number) => {
  const client = await getRedis();
  if (!client) return null;
  const window = Math.floor(now / WINDOW_MS);
  const redisKey = `commerceos:ratelimit:${key}:${window}`;
  const count = await client.incr(redisKey);
  if (count === 1) await client.pExpire(redisKey, WINDOW_MS + 1000);
  const resetAt = (window + 1) * WINDOW_MS;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
};

const consumeMemory = (key: string, limit: number, now = Date.now()) => {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS };
  }
  existing.count += 1;
  return { allowed: existing.count <= limit, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
};

export const rateLimit = async (req: IncomingMessage, res: ServerResponse, scope: "api" | "public-checkout") => {
  const limit = scope === "public-checkout" ? PUBLIC_CHECKOUT_MAX : MAX_REQUESTS;
  const key = `${scope}:${getClientKey(req)}`;
  let result;
  try {
    result = await consumeRedis(key, limit, Date.now());
  } catch (error) {
    console.error("Redis rate-limit unavailable", error);
    if (process.env.NODE_ENV === "production" && process.env.REDIS_REQUIRED === "true") {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "rate_limit_unavailable" }));
      return false;
    }
    result = null;
  }
  result ??= consumeMemory(key, limit);

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
