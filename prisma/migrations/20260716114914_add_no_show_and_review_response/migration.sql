-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "providerRespondedAt" TIMESTAMP(3),
ADD COLUMN     "providerResponse" VARCHAR(500);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "noShowStrikes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "NoShowReport" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "reportedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoShowReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoShowReport_bookingId_key" ON "NoShowReport"("bookingId");

-- CreateIndex
CREATE INDEX "NoShowReport_reportedUserId_idx" ON "NoShowReport"("reportedUserId");

-- AddForeignKey
ALTER TABLE "NoShowReport" ADD CONSTRAINT "NoShowReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowReport" ADD CONSTRAINT "NoShowReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowReport" ADD CONSTRAINT "NoShowReport_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
