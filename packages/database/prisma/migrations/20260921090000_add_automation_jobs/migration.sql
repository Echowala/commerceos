CREATE TABLE "AutomationJob" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "customerId" TEXT,
  "data" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationJob_eventId_key" ON "AutomationJob"("eventId");
CREATE INDEX "AutomationJob_status_availableAt_idx" ON "AutomationJob"("status", "availableAt");
CREATE INDEX "AutomationJob_tenantId_createdAt_idx" ON "AutomationJob"("tenantId", "createdAt");
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
