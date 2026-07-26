-- CreateEnum
CREATE TYPE "DebtorType" AS ENUM ('PROVIDER', 'CLIENT');

-- CreateEnum
CREATE TYPE "DebtRecordStatus" AS ENUM ('PENDING', 'NOTIFIED', 'PAID', 'WRITTEN_OFF');

-- CreateTable
CREATE TABLE "DebtRecord" (
    "id" TEXT NOT NULL,
    "disputeCaseId" TEXT NOT NULL,
    "debtorType" "DebtorType" NOT NULL,
    "clientId" TEXT,
    "providerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DebtRecordStatus" NOT NULL DEFAULT 'PENDING',
    "mpPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebtRecord_clientId_status_idx" ON "DebtRecord"("clientId", "status");

-- CreateIndex
CREATE INDEX "DebtRecord_providerId_status_idx" ON "DebtRecord"("providerId", "status");

-- CreateIndex
CREATE INDEX "DebtRecord_disputeCaseId_idx" ON "DebtRecord"("disputeCaseId");

-- AddForeignKey
ALTER TABLE "DebtRecord" ADD CONSTRAINT "DebtRecord_disputeCaseId_fkey" FOREIGN KEY ("disputeCaseId") REFERENCES "DisputeCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtRecord" ADD CONSTRAINT "DebtRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtRecord" ADD CONSTRAINT "DebtRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
