-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CHECKING', 'SAVINGS');

-- CreateTable
CREATE TABLE "ProviderBankAccount" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" "BankAccountType" NOT NULL,
    "agency" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountDigit" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "holderDocument" TEXT NOT NULL,
    "pixKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderBankAccount_providerId_key" ON "ProviderBankAccount"("providerId");

-- CreateIndex
CREATE INDEX "ProviderBankAccount_providerId_updatedAt_idx" ON "ProviderBankAccount"("providerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ProviderBankAccount" ADD CONSTRAINT "ProviderBankAccount_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
