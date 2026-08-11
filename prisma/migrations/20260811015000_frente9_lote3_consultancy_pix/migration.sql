-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN     "pixCopyPasteCode" TEXT,
ADD COLUMN     "pixExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pixQrCodeUrl" TEXT;
