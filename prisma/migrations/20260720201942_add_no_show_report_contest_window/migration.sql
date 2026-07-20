-- CreateEnum
CREATE TYPE "NoShowReportStatus" AS ENUM ('PENDING', 'CONTESTED', 'RESOLVED');

-- AlterTable
ALTER TABLE "NoShowReport" ADD COLUMN     "contestDeadlineAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "contestedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "status" "NoShowReportStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "NoShowReport_status_contestDeadlineAt_idx" ON "NoShowReport"("status", "contestDeadlineAt");
