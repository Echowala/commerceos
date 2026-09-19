import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type AuthClaims = {
  userId: string;
  tenantId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  exp: number;
};

const secret = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? (() => { throw new Error("AUTH_SECRET_REQUIRED"); })() : "development-only-change-me");

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (value: string) => createHash("sha256").update(`${value}.${secret}`).digest("base64url");

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

export const hashPassword = (password: string) => createHash("sha256").update(password).digest("hex");
export const generateSessionId = () => randomBytes(16).toString("hex");
