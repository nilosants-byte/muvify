-- CreateEnum
CREATE TYPE "ContentReportStatus" AS ENUM ('PENDING', 'DISMISSED', 'ACTIONED');

-- AlterTable
ALTER TABLE "BookingMessage" ADD COLUMN     "hiddenByAdminAt" TIMESTAMP(3),
ADD COLUMN     "hiddenByAdminId" TEXT;

-- AlterTable
ALTER TABLE "BookingMessageReport" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "ContentReportStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "ConsultancyMessage" ADD COLUMN     "hiddenByAdminAt" TIMESTAMP(3),
ADD COLUMN     "hiddenByAdminId" TEXT;

-- AlterTable
ALTER TABLE "ConsultancyMessageReport" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "ContentReportStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "FeedPost" ADD COLUMN     "hiddenByAdminAt" TIMESTAMP(3),
ADD COLUMN     "hiddenByAdminId" TEXT;

-- AlterTable
ALTER TABLE "FeedPostReport" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "ContentReportStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "BookingMessageReport_status_createdAt_idx" ON "BookingMessageReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultancyMessageReport_status_createdAt_idx" ON "ConsultancyMessageReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPostReport_status_createdAt_idx" ON "FeedPostReport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingMessage" ADD CONSTRAINT "BookingMessage_hiddenByAdminId_fkey" FOREIGN KEY ("hiddenByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingMessageReport" ADD CONSTRAINT "BookingMessageReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyMessage" ADD CONSTRAINT "ConsultancyMessage_hiddenByAdminId_fkey" FOREIGN KEY ("hiddenByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyMessageReport" ADD CONSTRAINT "ConsultancyMessageReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_hiddenByAdminId_fkey" FOREIGN KEY ("hiddenByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostReport" ADD CONSTRAINT "FeedPostReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

