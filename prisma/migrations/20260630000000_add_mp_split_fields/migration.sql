-- AlterTable: ProviderProfile — campos OAuth do Mercado Pago
ALTER TABLE "ProviderProfile"
  ADD COLUMN "mpAccessToken"    TEXT,
  ADD COLUMN "mpRefreshToken"   TEXT,
  ADD COLUMN "mpTokenExpiresAt" TIMESTAMP(3);

-- AlterTable: Payment — valores líquidos do split 90/10
ALTER TABLE "Payment"
  ADD COLUMN "providerAmountCents" INTEGER,
  ADD COLUMN "platformFeeCents"    INTEGER;
