-- Add tenant-scoped customer segments with JSON rule definitions.
CREATE TABLE "CustomerSegment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rules" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerSegment_tenantId_name_key" ON "CustomerSegment"("tenantId", "name");
CREATE INDEX "CustomerSegment_tenantId_createdAt_idx" ON "CustomerSegment"("tenantId", "createdAt");

ALTER TABLE "CustomerSegment" ADD CONSTRAINT "CustomerSegment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
