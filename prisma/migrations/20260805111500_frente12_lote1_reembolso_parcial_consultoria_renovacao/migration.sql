-- AlterEnum
ALTER TYPE "ConsultancyPaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN     "refundedAmountCents" INTEGER;

-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "refundedAmountCents" INTEGER;

