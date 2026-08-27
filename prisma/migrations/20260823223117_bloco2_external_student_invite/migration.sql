-- CreateEnum
CREATE TYPE "ExternalStudentInviteStatus" AS ENUM ('PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExternalStudentInviteChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateTable
CREATE TABLE "ExternalStudentInvite" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "channel" "ExternalStudentInviteChannel" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "status" "ExternalStudentInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,
    "contractId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalStudentInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalStudentInvite_tokenHash_key" ON "ExternalStudentInvite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalStudentInvite_contractId_key" ON "ExternalStudentInvite"("contractId");

-- CreateIndex
CREATE INDEX "ExternalStudentInvite_providerId_status_idx" ON "ExternalStudentInvite"("providerId", "status");

-- AddForeignKey
ALTER TABLE "ExternalStudentInvite" ADD CONSTRAINT "ExternalStudentInvite_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalStudentInvite" ADD CONSTRAINT "ExternalStudentInvite_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalStudentInvite" ADD CONSTRAINT "ExternalStudentInvite_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ConsultancyContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
