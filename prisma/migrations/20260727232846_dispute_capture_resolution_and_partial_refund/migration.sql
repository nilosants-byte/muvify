-- AlterEnum
ALTER TYPE "DisputeCaseResolution" ADD VALUE 'CAPTURED';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundedAmountCents" INTEGER;
