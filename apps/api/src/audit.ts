import type { IncomingMessage } from "node:http";
import { prisma } from "@commerceos/database";
import type { Prisma } from "@prisma/client";

const MAX_METADATA_BYTES = 20_000;

const sanitizeMetadata = (metadata?: Record<string, unknown>): Prisma.InputJsonValue | undefined => {
  if (!metadata) return undefined;
  try {
    const serialized = JSON.stringify(metadata);
    if (serialized.length > MAX_METADATA_BYTES) return { truncated: true };
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    return { invalid: true };
  }
};

const requestIp = (req: IncomingMessage): string | null => {
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim().slice(0, 128);
  }
  return req.socket.remoteAddress ?? null;
};

export const audit = async (
  tenantId: string,
  userId: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  req: IncomingMessage,
  metadata?: Record<string, unknown>
): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        resource,
        resourceId,
        metadata: sanitizeMetadata(metadata),
        ipAddress: requestIp(req),
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 512) : null,
      },
    });
  } catch (error) {
    console.error("Audit log persistence failed", {
      action,
      resource,
      resourceId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
};