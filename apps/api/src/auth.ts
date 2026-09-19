import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type AuthClaims = {
  userId: string;
  tenantId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  sessionVersion: number;
  exp: number;
};

const secret = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? (() => { throw new Error("AUTH_SECRET_REQUIRED"); })() : "development-only-change-me");

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (value: string) => createHmac("sha256", secret).update(value).digest("base64url");

export const createToken = (claims: Omit<AuthClaims, "exp">, ttlSeconds = 60 * 60 * 24 * 7) => {
  const payload = encode({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  return `${payload}.${sign(payload)}`;
};

export const verifyToken = (token: string): AuthClaims | null => {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthClaims;
    return claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
  } catch {
    return null;
  }
};

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

export const hashPassword = (password: string) => {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 32 * 1024 * 1024 });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derived.toString("base64url")].join("$");
};

export const verifyPassword = (password: string, storedHash: string) => {
  const parts = storedHash.split("$");
  if (parts.length === 6 && parts[0] === "scrypt") {
    const [, n, r, p, saltEncoded, hashEncoded] = parts;
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);
    if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P) || !saltEncoded || !hashEncoded) return false;
    try {
      const salt = Buffer.from(saltEncoded, "base64url");
      const expected = Buffer.from(hashEncoded, "base64url");
      const actual = scryptSync(password, salt, expected.length, { N, r: R, p: P, maxmem: 32 * 1024 * 1024 });
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  // Legacy SHA-256 hashes are accepted temporarily so existing dev accounts can still log in.
  const legacy = createHash("sha256").update(password).digest("hex");
  return storedHash.length === legacy.length && timingSafeEqual(Buffer.from(storedHash), Buffer.from(legacy));
};
export const generateSessionId = () => randomBytes(16).toString("hex");
