-- AlterTable
ALTER TABLE "ProviderProfile"
  ADD COLUMN IF NOT EXISTS "crefNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "crefDocumentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "credentialDocuments" JSONB,
  ADD COLUMN IF NOT EXISTS "crefValidatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConsultancyContract"
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConsultancyContract_stripePaymentIntentId_key"
  ON "ConsultancyContract"("stripePaymentIntentId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "data" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserNotification_userId_createdAt_idx"
  ON "UserNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserNotification_userId_readAt_idx"
  ON "UserNotification"("userId", "readAt");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "UserNotification"
    ADD CONSTRAINT "UserNotification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;