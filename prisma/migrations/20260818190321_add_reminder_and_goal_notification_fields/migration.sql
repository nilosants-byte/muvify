-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN     "inactivityReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastGoalReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "lastGoalSetupNudgeSentAt" TIMESTAMP(3),
ADD COLUMN     "weeklyGoalConfiguredAt" TIMESTAMP(3);
