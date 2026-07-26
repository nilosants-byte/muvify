-- AlterTable
ALTER TABLE "PresentialPackage" ADD COLUMN     "clientLatitude" DOUBLE PRECISION,
ADD COLUMN     "clientLongitude" DOUBLE PRECISION,
ADD COLUMN     "sessionLocation" TEXT;

-- AlterTable
ALTER TABLE "ProviderServiceOffer" ADD COLUMN     "offerServiceMode" "ProviderServiceMode";
