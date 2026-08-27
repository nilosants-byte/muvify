-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN     "externalCheckInDueAt" TIMESTAMP(3),
ADD COLUMN     "externalCheckInReminderSentAt" TIMESTAMP(3);
