-- AlterTable
ALTER TABLE "PresentialPackage" ADD COLUMN     "categoryId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "PresentialPackage" ADD CONSTRAINT "PresentialPackage_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

