import { prisma } from "@commerceos/database";
import { createToken, hashPassword } from "./auth.js";

export async function signup(input: { email?: string; password?: string; name?: string; tenantName?: string }) {
  const email = input.email?.trim().toLowerCase();
  const password = input.password;
  const tenantName = input.tenantName?.trim();
  if (!email || !password || !tenantName) throw new Error("email, password and tenantName are required");
  if (password.length < 8) throw new Error("password must be at least 8 characters");

  const tenantSlug = `${tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: tenantName, slug: tenantSlug } });
    const user = await tx.user.create({ data: { tenantId: tenant.id, email, passwordHash: hashPassword(password), name: input.name, role: "OWNER" } });
    const store = await tx.store.create({ data: { tenantId: tenant.id, name: tenantName, slug: "main", currency: "PKR" } });
    return { tenant, user, store };
  });

  return { token: createToken({ userId: result.user.id, tenantId: result.tenant.id, role: result.user.role, sessionVersion: result.user.sessionVersion }), tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug }, store: { id: result.store.id, name: result.store.name, slug: result.store.slug } };
}
