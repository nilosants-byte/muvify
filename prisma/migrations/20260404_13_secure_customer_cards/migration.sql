-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "stripePaymentMethodId" TEXT;

-- CreateTable
CREATE TABLE "CustomerPaymentMethod" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "stripePaymentMethodId" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "funding" TEXT,
  "expMonth" INTEGER,
  "expYear" INTEGER,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerPaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentMethod_stripePaymentMethodId_key" ON "CustomerPaymentMethod"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "CustomerPaymentMethod_userId_isActive_idx" ON "CustomerPaymentMethod"("userId", "isActive");

-- CreateIndex
CREATE INDEX "CustomerPaymentMethod_userId_isDefault_idx" ON "CustomerPaymentMethod"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "Payment_stripePaymentMethodId_idx" ON "Payment"("stripePaymentMethodId");

-- AddForeignKey
ALTER TABLE "CustomerPaymentMethod" ADD CONSTRAINT "CustomerPaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
