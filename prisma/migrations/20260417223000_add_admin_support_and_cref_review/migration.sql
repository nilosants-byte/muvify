-- CreateEnum
CREATE TYPE "CrefValidationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'ANSWERED');

-- AlterTable
ALTER TABLE "ProviderProfile"
  ADD COLUMN "crefValidationStatus" "CrefValidationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "crefRejectionReason" VARCHAR(300),
  ADD COLUMN "crefReviewedAt" TIMESTAMP(3),
  ADD COLUMN "crefReviewedByUserId" TEXT;

-- Backfill
UPDATE "ProviderProfile"
SET "crefValidationStatus" = CASE
  WHEN "crefValidatedAt" IS NOT NULL THEN 'APPROVED'::"CrefValidationStatus"
  ELSE 'PENDING'::"CrefValidationStatus"
END;

-- CreateTable
CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subject" TEXT,
  "message" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "adminResponse" VARCHAR(300),
  "respondedAt" TIMESTAMP(3),
  "respondedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_respondedByUserId_respondedAt_idx" ON "SupportTicket"("respondedByUserId", "respondedAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_respondedByUserId_fkey"
  FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
