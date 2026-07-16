-- AlterTable
ALTER TABLE "User" ADD COLUMN     "documentHash" TEXT;

-- CreateIndex
CREATE INDEX "User_documentHash_idx" ON "User"("documentHash");
