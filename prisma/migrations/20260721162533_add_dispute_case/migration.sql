-- CreateEnum
CREATE TYPE "DisputeCaseType" AS ENUM ('NO_SHOW_CONTESTED', 'CHARGEBACK', 'REFUND_FAILED');

-- CreateEnum
CREATE TYPE "DisputeCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeCaseResolution" AS ENUM ('REFUNDED', 'DENIED');

-- AlterTable
ALTER TABLE "NoShowReport" ADD COLUMN     "contestReason" TEXT,
ADD COLUMN     "reportReason" TEXT;

-- CreateTable
CREATE TABLE "DisputeCase" (
    "id" TEXT NOT NULL,
    "type" "DisputeCaseType" NOT NULL,
    "status" "DisputeCaseStatus" NOT NULL DEFAULT 'OPEN',
    "clientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "mpPaymentId" TEXT,
    "contextNote" TEXT,
    "bookingId" TEXT,
    "consultancyContractId" TEXT,
    "presentialPackageId" TEXT,
    "presentialPackageCycleId" TEXT,
    "noShowReportId" TEXT,
    "resolution" "DisputeCaseResolution",
    "resolvedAmountCents" INTEGER,
    "resolutionNote" TEXT,
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisputeCase_noShowReportId_key" ON "DisputeCase"("noShowReportId");

-- CreateIndex
CREATE INDEX "DisputeCase_status_createdAt_idx" ON "DisputeCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeCase_clientId_idx" ON "DisputeCase"("clientId");

-- CreateIndex
CREATE INDEX "DisputeCase_providerId_idx" ON "DisputeCase"("providerId");

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_consultancyContractId_fkey" FOREIGN KEY ("consultancyContractId") REFERENCES "ConsultancyContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_presentialPackageId_fkey" FOREIGN KEY ("presentialPackageId") REFERENCES "PresentialPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_presentialPackageCycleId_fkey" FOREIGN KEY ("presentialPackageCycleId") REFERENCES "PresentialPackageCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_noShowReportId_fkey" FOREIGN KEY ("noShowReportId") REFERENCES "NoShowReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

