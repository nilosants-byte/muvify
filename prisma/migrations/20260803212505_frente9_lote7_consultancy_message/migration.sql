-- CreateTable
CREATE TABLE "ConsultancyMessage" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "senderId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultancyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsultancyMessage_contractId_createdAt_idx" ON "ConsultancyMessage"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultancyMessage_senderId_createdAt_idx" ON "ConsultancyMessage"("senderId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsultancyMessage" ADD CONSTRAINT "ConsultancyMessage_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ConsultancyContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyMessage" ADD CONSTRAINT "ConsultancyMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

