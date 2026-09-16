-- Detect accidental reuse of an idempotency key for a different checkout payload.
ALTER TABLE "Order" ADD COLUMN "idempotencyFingerprint" TEXT;
