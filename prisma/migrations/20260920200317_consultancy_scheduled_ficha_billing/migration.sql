-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN     "consecutiveFailedRenewalCycles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fichaEscalationSentAt" TIMESTAMP(3),
ADD COLUMN     "fichaExpiredNoticeSentAt" TIMESTAMP(3),
ADD COLUMN     "fichaReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "lastBilledContentAt" TIMESTAMP(3),
ADD COLUMN     "lastRenewalFailureReason" TEXT,
ADD COLUMN     "nextBillingAt" TIMESTAMP(3),
ADD COLUMN     "nextRenewalCycleIndex" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "ConsultancyContract_status_nextBillingAt_idx" ON "ConsultancyContract"("status", "nextBillingAt");
