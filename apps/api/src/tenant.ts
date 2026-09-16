import type { IncomingHttpHeaders } from "node:http";
import { verifyToken, type AuthClaims } from "./auth.js";

export type RequestContext = { auth: AuthClaims | null; tenantId: string | null };

export const getRequestContext = (headers: IncomingHttpHeaders): RequestContext => {
  const authorization = headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  const auth = token ? verifyToken(token) : null;
  return { auth, tenantId: auth?.tenantId ?? null };
};

export const requireTenant = (context: RequestContext) => {
  if (!context.auth || !context.tenantId) throw new Error("UNAUTHORIZED");
  return context.tenantId;
};
