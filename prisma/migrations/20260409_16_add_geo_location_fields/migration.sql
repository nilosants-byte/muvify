-- CreateEnum
CREATE TYPE "ProviderServiceMode" AS ENUM ('PRESENTIAL_ONLY', 'HOME_VISIT_ONLY', 'BOTH');

-- AlterTable
ALTER TABLE "ProviderProfile"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "serviceMode" "ProviderServiceMode" NOT NULL DEFAULT 'BOTH',
  ADD COLUMN "fixedLocations" JSONB,
  ADD COLUMN "excludedLocations" JSONB;
