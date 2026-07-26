-- AlterTable
ALTER TABLE "ProviderServiceOffer" ADD COLUMN     "fichaValidityDays" INTEGER;

-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "expiredNoticeSentAt" TIMESTAMP(3),
ADD COLUMN     "expiryReminderSentAt" TIMESTAMP(3);
