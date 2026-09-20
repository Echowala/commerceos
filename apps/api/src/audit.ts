import type { IncomingMessage } from "node:http";
import { prisma } from "@commerceos/database";

export const audit = async (
  tenantId: string,
  userId: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  req: IncomingMessage,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action,
      resource,
      resourceId,
      metadata,
      ipAddress: req.socket.remoteAddress ?? null,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    },
  });
};
