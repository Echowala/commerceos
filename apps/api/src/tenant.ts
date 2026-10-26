import type { IncomingHttpHeaders } from "node:http";
import { verifyToken, type AuthClaims } from "./auth.js";
import { prisma } from "@commerceos/database";

export type RequestContext = { auth: AuthClaims | null; tenantId: string | null };

type TenantUserLookup = (userId: string, tenantId: string) => Promise<{ role: AuthClaims["role"]; sessionVersion: number } | null>;

const lookupTenantUser: TenantUserLookup = async (userId, tenantId) => prisma.user.findFirst({
  where: { id: userId, tenantId },
  select: { role: true, sessionVersion: true },
});

export const getRequestContext = async (headers: IncomingHttpHeaders, lookupUser: TenantUserLookup = lookupTenantUser): Promise<RequestContext> => {
  const authorization = headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  const auth = token ? verifyToken(token) : null;
  if (!auth) return { auth: null, tenantId: null };
  const user = await lookupUser(auth.userId, auth.tenantId);
  if (!user || user.role !== auth.role || user.sessionVersion !== auth.sessionVersion) return { auth: null, tenantId: null };
  return { auth, tenantId: auth.tenantId };
};

export const requireTenant = (context: RequestContext) => {
  if (!context.auth || !context.tenantId) throw new Error("UNAUTHORIZED");
  return context.tenantId;
};

export const requireRole = (context: RequestContext, ...allowed: AuthClaims["role"][]) => {
  if (!context.auth || !allowed.includes(context.auth.role)) throw new Error("FORBIDDEN");
  return context.auth;
};
