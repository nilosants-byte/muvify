-- AlterTable
ALTER TABLE "DisputeCase" ADD COLUMN     "trainingPlanId" TEXT;

-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "lastEscalationSentAt" TIMESTAMP(3),
ADD COLUMN     "renewalMpPaymentId" TEXT;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_trainingPlanId_fkey" FOREIGN KEY ("trainingPlanId") REFERENCES "TrainingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
