-- AlterTable
ALTER TABLE "EmailVerificationToken" DROP COLUMN "reminderSentAt";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationReminderSentAt" TIMESTAMP(3);
