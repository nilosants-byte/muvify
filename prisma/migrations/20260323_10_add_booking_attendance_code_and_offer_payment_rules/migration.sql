-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT_CARD';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'DEBIT_CARD';

-- AlterTable
ALTER TABLE "Booking"
  ADD COLUMN "attendanceCode" TEXT,
  ADD COLUMN "attendanceCodeGeneratedAt" TIMESTAMP(3),
  ADD COLUMN "attendanceCodeExpiresAt" TIMESTAMP(3),
  ADD COLUMN "attendanceCodeValidatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConsultancyContract"
  ADD COLUMN "paymentInstallments" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ProviderServiceOffer"
  ADD COLUMN "acceptsPix" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "acceptsDebitCard" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "acceptsCreditCard" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "maxCreditInstallments" INTEGER NOT NULL DEFAULT 1;