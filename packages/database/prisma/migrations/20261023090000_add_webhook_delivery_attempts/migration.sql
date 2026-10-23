CREATE TABLE "WebhookDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "httpStatus" INTEGER,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_deliveryId_attemptNumber_key" ON "WebhookDeliveryAttempt"("deliveryId","attemptNumber");
CREATE INDEX "WebhookDeliveryAttempt_deliveryId_startedAt_idx" ON "WebhookDeliveryAttempt"("deliveryId","startedAt");
CREATE INDEX "WebhookDeliveryAttempt_status_startedAt_idx" ON "WebhookDeliveryAttempt"("status","startedAt");
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
