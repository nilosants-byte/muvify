-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'PIX');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'CARD';
