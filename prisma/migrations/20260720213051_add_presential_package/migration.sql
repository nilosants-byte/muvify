-- CreateEnum
CREATE TYPE "PresentialPackageMode" AS ENUM ('FIXED_RECURRING', 'FLEXIBLE_CREDITS');

-- CreateEnum
CREATE TYPE "PresentialPackageStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "packageId" TEXT;

-- AlterTable
ALTER TABLE "ProviderServiceOffer" ADD COLUMN     "comboConsultancyShareCents" INTEGER,
ADD COLUMN     "comboPresentialShareCents" INTEGER,
ADD COLUMN     "presentialHasFixedTerm" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "presentialPackageMode" "PresentialPackageMode",
ADD COLUMN     "presentialSessionsPerCycle" INTEGER,
ADD COLUMN     "presentialTotalCycles" INTEGER;

-- CreateTable
CREATE TABLE "PresentialPackage" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "consultancyContractId" TEXT,
    "mode" "PresentialPackageMode" NOT NULL,
    "status" "PresentialPackageStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" "ConsultancyPaymentMethod",
    "mpSubscriptionId" TEXT,
    "cycleAmountCents" INTEGER NOT NULL,
    "billingCycle" "OfferBillingCycle" NOT NULL,
    "sessionsPerCycle" INTEGER NOT NULL,
    "weeklySchedule" JSONB,
    "hasFixedTerm" BOOLEAN NOT NULL DEFAULT false,
    "totalCycles" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresentialPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresentialPackageCycle" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "providerAmountCents" INTEGER NOT NULL,
    "platformAmountCents" INTEGER NOT NULL,
    "sessionsGranted" INTEGER NOT NULL,
    "mpPaymentId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresentialPackageCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PresentialPackage_consultancyContractId_key" ON "PresentialPackage"("consultancyContractId");

-- CreateIndex
CREATE UNIQUE INDEX "PresentialPackage_mpSubscriptionId_key" ON "PresentialPackage"("mpSubscriptionId");

-- CreateIndex
CREATE INDEX "PresentialPackage_providerId_status_idx" ON "PresentialPackage"("providerId", "status");

-- CreateIndex
CREATE INDEX "PresentialPackage_clientId_status_idx" ON "PresentialPackage"("clientId", "status");

-- CreateIndex
CREATE INDEX "PresentialPackageCycle_packageId_idx" ON "PresentialPackageCycle"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "PresentialPackageCycle_packageId_cycleIndex_key" ON "PresentialPackageCycle"("packageId", "cycleIndex");

-- CreateIndex
CREATE INDEX "Booking_packageId_idx" ON "Booking"("packageId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PresentialPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentialPackage" ADD CONSTRAINT "PresentialPackage_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentialPackage" ADD CONSTRAINT "PresentialPackage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentialPackage" ADD CONSTRAINT "PresentialPackage_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ProviderServiceOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentialPackage" ADD CONSTRAINT "PresentialPackage_consultancyContractId_fkey" FOREIGN KEY ("consultancyContractId") REFERENCES "ConsultancyContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentialPackageCycle" ADD CONSTRAINT "PresentialPackageCycle_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PresentialPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
