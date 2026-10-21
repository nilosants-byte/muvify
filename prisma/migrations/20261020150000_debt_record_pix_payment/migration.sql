-- Pendência financeira também pode ser paga por Pix (teste manual C8.1).
ALTER TABLE "DebtRecord" ADD COLUMN "pendingPixMpPaymentId" TEXT;
ALTER TABLE "DebtRecord" ADD COLUMN "pendingPixQrCodeUrl" TEXT;
ALTER TABLE "DebtRecord" ADD COLUMN "pendingPixCopyPasteCode" TEXT;
ALTER TABLE "DebtRecord" ADD COLUMN "pendingPixExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "DebtRecord_pendingPixMpPaymentId_key" ON "DebtRecord"("pendingPixMpPaymentId");
