-- Rename Stripe columns to Mercado Pago equivalents

-- User
ALTER TABLE "User" RENAME COLUMN "stripeCustomerId" TO "mpCustomerId";
ALTER TABLE "User" RENAME COLUMN "stripeDefaultPaymentMethodId" TO "mpDefaultCardId";

-- ProviderProfile
ALTER TABLE "ProviderProfile" RENAME COLUMN "stripeAccountId" TO "mpAccountId";

-- Payment
ALTER TABLE "Payment" RENAME COLUMN "stripePaymentIntentId" TO "mpPaymentId";
ALTER TABLE "Payment" RENAME COLUMN "stripePaymentMethodId" TO "mpCardToken";
ALTER TABLE "Payment" RENAME COLUMN "stripeChargeId" TO "mpChargeId";
DROP INDEX IF EXISTS "Payment_stripePaymentIntentId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_mpPaymentId_key" ON "Payment"("mpPaymentId");
DROP INDEX IF EXISTS "Payment_stripePaymentMethodId_idx";
CREATE INDEX IF NOT EXISTS "Payment_mpCardToken_idx" ON "Payment"("mpCardToken");

-- CustomerPaymentMethod
ALTER TABLE "CustomerPaymentMethod" RENAME COLUMN "stripeCustomerId" TO "mpCustomerId";
ALTER TABLE "CustomerPaymentMethod" RENAME COLUMN "stripePaymentMethodId" TO "mpCardId";
DROP INDEX IF EXISTS "CustomerPaymentMethod_stripePaymentMethodId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerPaymentMethod_mpCardId_key" ON "CustomerPaymentMethod"("mpCardId");

-- ConsultancyContract
ALTER TABLE "ConsultancyContract" RENAME COLUMN "stripePaymentIntentId" TO "mpPaymentId";
ALTER TABLE "ConsultancyContract" RENAME COLUMN "stripeRefundId" TO "mpRefundId";
DROP INDEX IF EXISTS "ConsultancyContract_stripePaymentIntentId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ConsultancyContract_mpPaymentId_key" ON "ConsultancyContract"("mpPaymentId");
