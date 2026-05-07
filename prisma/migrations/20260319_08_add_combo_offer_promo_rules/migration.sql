-- AlterEnum
ALTER TYPE "ServiceOfferKind" ADD VALUE IF NOT EXISTS 'COMBO';

-- AlterTable
ALTER TABLE "ProviderServiceOffer"
ADD COLUMN "comboPresentialDaysPerWeek" INTEGER,
ADD COLUMN "comboOnlineDaysPerWeek" INTEGER,
ADD COLUMN "basePriceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "promotionPriceCents" INTEGER,
ADD COLUMN "promotionEndsAt" TIMESTAMP(3);

-- Data backfill safety
UPDATE "ProviderServiceOffer"
SET "basePriceUpdatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "basePriceUpdatedAt" IS NULL;
