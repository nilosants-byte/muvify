-- AlterEnum
ALTER TYPE "PresentialPackageStatus" ADD VALUE 'PAST_DUE';

-- DropIndex
DROP INDEX "PresentialPackage_mpSubscriptionId_key";

-- AlterTable
ALTER TABLE "PresentialPackage" DROP COLUMN "mpSubscriptionId",
ADD COLUMN     "billingCardId" TEXT,
ADD COLUMN     "consecutiveFailedCycles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditsRemainingThisCycle" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastBillingFailureReason" TEXT,
ADD COLUMN     "nextBillingAt" TIMESTAMP(3),
ADD COLUMN     "nextCycleIndex" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pendingChargeMpPaymentId" TEXT,
ADD COLUMN     "pendingChargePixCopyPasteCode" TEXT,
ADD COLUMN     "pendingChargePixExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pendingChargePixQrCodeUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PresentialPackage_pendingChargeMpPaymentId_key" ON "PresentialPackage"("pendingChargeMpPaymentId");

-- CreateIndex
CREATE INDEX "PresentialPackage_status_nextBillingAt_idx" ON "PresentialPackage"("status", "nextBillingAt");

