-- CreateEnum
CREATE TYPE "CameraFacing" AS ENUM ('FRONT', 'BACK');

-- CreateTable
CREATE TABLE "CompletionEvidence" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cameraFacing" "CameraFacing" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "imageBase64" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompletionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompletionEvidence_bookingId_userId_key" ON "CompletionEvidence"("bookingId", "userId");

-- CreateIndex
CREATE INDEX "CompletionEvidence_bookingId_idx" ON "CompletionEvidence"("bookingId");

-- CreateIndex
CREATE INDEX "CompletionEvidence_userId_idx" ON "CompletionEvidence"("userId");

-- AddForeignKey
ALTER TABLE "CompletionEvidence" ADD CONSTRAINT "CompletionEvidence_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionEvidence" ADD CONSTRAINT "CompletionEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
