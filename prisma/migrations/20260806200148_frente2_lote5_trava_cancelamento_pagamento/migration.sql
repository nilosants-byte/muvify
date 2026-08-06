-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "mutationLockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN     "cancelLockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PresentialPackage" ADD COLUMN     "cancelLockedAt" TIMESTAMP(3);
