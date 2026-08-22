-- AlterTable
ALTER TABLE "WaitlistSignup" ADD COLUMN     "name" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistSignup_whatsapp_key" ON "WaitlistSignup"("whatsapp");
