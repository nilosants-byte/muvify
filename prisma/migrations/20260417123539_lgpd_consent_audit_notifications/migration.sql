-- CreateEnum
CREATE TYPE "NotificationPreferenceType" AS ENUM ('BOOKINGS', 'PAYMENTS', 'MARKETING', 'CONSULTANCY', 'SYSTEM');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "privacyPolicyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT;

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationPreferenceType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAuditLog" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "consultancyContractId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE INDEX "PaymentAuditLog_paymentId_createdAt_idx" ON "PaymentAuditLog"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAuditLog_consultancyContractId_createdAt_idx" ON "PaymentAuditLog"("consultancyContractId", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
