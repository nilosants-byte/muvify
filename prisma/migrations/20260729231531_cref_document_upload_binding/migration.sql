-- CreateTable
CREATE TABLE "CrefDocumentUpload" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedByUser" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrefDocumentUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrefDocumentUpload_storageKey_key" ON "CrefDocumentUpload"("storageKey");

-- CreateIndex
CREATE INDEX "CrefDocumentUpload_uploadedByUser_idx" ON "CrefDocumentUpload"("uploadedByUser");

-- AddForeignKey
ALTER TABLE "CrefDocumentUpload" ADD CONSTRAINT "CrefDocumentUpload_uploadedByUser_fkey" FOREIGN KEY ("uploadedByUser") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
