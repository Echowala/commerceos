-- Add CRM customer tags, tag assignments, and customer events.
CREATE TYPE "CustomerEventType" AS ENUM ('ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'CUSTOMER_CREATED', 'NOTE');

CREATE TABLE "CustomerTag" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerTagAssignment" (
  "customerId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerTagAssignment_pkey" PRIMARY KEY ("customerId", "tagId")
);

CREATE TABLE "CustomerEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" "CustomerEventType" NOT NULL,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerTag_tenantId_name_key" ON "CustomerTag"("tenantId", "name");
CREATE INDEX "CustomerTag_tenantId_idx" ON "CustomerTag"("tenantId");
CREATE INDEX "CustomerTagAssignment_tagId_idx" ON "CustomerTagAssignment"("tagId");
CREATE INDEX "CustomerEvent_tenantId_createdAt_idx" ON "CustomerEvent"("tenantId", "createdAt");
CREATE INDEX "CustomerEvent_customerId_createdAt_idx" ON "CustomerEvent"("customerId", "createdAt");
CREATE INDEX "CustomerEvent_customerId_type_createdAt_idx" ON "CustomerEvent"("customerId", "type", "createdAt");

ALTER TABLE "CustomerTag" ADD CONSTRAINT "CustomerTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTagAssignment" ADD CONSTRAINT "CustomerTagAssignment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTagAssignment" ADD CONSTRAINT "CustomerTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CustomerTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerEvent" ADD CONSTRAINT "CustomerEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerEvent" ADD CONSTRAINT "CustomerEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
