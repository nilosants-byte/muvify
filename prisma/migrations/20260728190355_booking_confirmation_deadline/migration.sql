-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "confirmationDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "confirmationReminderSentAt" TIMESTAMP(3);
