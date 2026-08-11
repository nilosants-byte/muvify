-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "consultancyContractId" TEXT,
ALTER COLUMN "bookingId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Review_consultancyContractId_key" ON "Review"("consultancyContractId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_consultancyContractId_fkey" FOREIGN KEY ("consultancyContractId") REFERENCES "ConsultancyContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
