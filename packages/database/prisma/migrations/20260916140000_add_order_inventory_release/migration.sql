-- Make order stock release idempotent across repeated or concurrent cancellation/refund requests.
ALTER TABLE "Order" ADD COLUMN "inventoryReleasedAt" TIMESTAMP(3);
