-- DropIndex
DROP INDEX "ProviderProfile_crefValidatedAt_averageRating_totalReviews_idx";

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "priceCents" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "presentationVideoUrl" TEXT,
ALTER COLUMN "priceCents" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "photoUrl" TEXT;

-- CreateTable
CREATE TABLE "ProviderManualBlock" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderManualBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderManualBlock_providerId_date_idx" ON "ProviderManualBlock"("providerId", "date");

-- CreateIndex
CREATE INDEX "Booking_providerId_status_idx" ON "Booking"("providerId", "status");

-- CreateIndex
CREATE INDEX "Booking_clientId_status_idx" ON "Booking"("clientId", "status");

-- CreateIndex
CREATE INDEX "ProviderProfile_serviceMode_averageRating_idx" ON "ProviderProfile"("serviceMode", "averageRating");

-- CreateIndex
CREATE INDEX "ProviderProfile_latitude_longitude_idx" ON "ProviderProfile"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "ProviderProfile_crefValidatedAt_averageRating_totalReviews_idx" ON "ProviderProfile"("crefValidatedAt", "averageRating", "totalReviews");

-- AddForeignKey
ALTER TABLE "ProviderManualBlock" ADD CONSTRAINT "ProviderManualBlock_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
