-- CommerceOS checkout foundation migration.
-- Safe for an existing Order table: new enum/columns use defaults or remain nullable.

CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'MANUAL_BANK', 'CARD', 'WALLET');

ALTER TABLE "Order"
  ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'COD',
  ADD COLUMN "shippingName" TEXT,
  ADD COLUMN "shippingPhone" TEXT,
  ADD COLUMN "shippingAddress" TEXT;
