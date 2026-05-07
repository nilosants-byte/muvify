-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM (
  'PENDING_AUTH',
  'AUTHORIZING',
  'AUTHORIZED',
  'CAPTURED',
  'CANCELED',
  'FAILED',
  'REFUNDED'
);

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripeDefaultPaymentMethodId" TEXT;

-- AlterTable
ALTER TABLE "ProviderProfile"
ADD COLUMN "priceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stripeAccountId" TEXT;

-- AlterTable
ALTER TABLE "Booking"
ADD COLUMN "priceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'BRL',
ADD COLUMN "clientConfirmedAt" TIMESTAMP(3),
ADD COLUMN "providerConfirmedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING_AUTH',
  "stripePaymentIntentId" TEXT,
  "stripeChargeId" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_status_authorizedAt_idx" ON "Payment"("status", "authorizedAt");

-- AddForeignKey
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
