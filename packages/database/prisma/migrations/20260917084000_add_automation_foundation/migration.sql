CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
CREATE TYPE "AutomationTrigger" AS ENUM ('ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'CUSTOMER_CREATED', 'INVENTORY_LOW');
CREATE TYPE "AutomationActionType" AS ENUM ('ADD_CUSTOMER_TAG', 'CREATE_CUSTOMER_NOTE', 'SEND_WEBHOOK');

CREATE TABLE "Automation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
  "trigger" "AutomationTrigger" NOT NULL,
  "conditions" JSONB NOT NULL,
  "actions" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Automation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Automation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Automation_tenantId_name_key" ON "Automation"("tenantId", "name");
CREATE INDEX "Automation_tenantId_status_idx" ON "Automation"("tenantId", "status");
CREATE INDEX "Automation_tenantId_trigger_status_idx" ON "Automation"("tenantId", "trigger", "status");

CREATE TABLE "AutomationExecution" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "triggerEventId" TEXT,
  "status" TEXT NOT NULL,
  "input" JSONB,
  "output" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AutomationExecution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AutomationExecution_tenantId_startedAt_idx" ON "AutomationExecution"("tenantId", "startedAt");
CREATE INDEX "AutomationExecution_automationId_startedAt_idx" ON "AutomationExecution"("automationId", "startedAt");
CREATE INDEX "AutomationExecution_triggerEventId_idx" ON "AutomationExecution"("triggerEventId");
