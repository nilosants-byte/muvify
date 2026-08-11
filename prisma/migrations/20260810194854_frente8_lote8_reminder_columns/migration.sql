-- AlterTable
ALTER TABLE "ClientAnamnesis" ADD COLUMN     "draftReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

