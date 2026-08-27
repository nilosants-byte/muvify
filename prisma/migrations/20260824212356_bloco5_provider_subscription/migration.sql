-- CreateEnum
CREATE TYPE "ProviderSubscriptionStatus" AS ENUM ('TRIALING', 'PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- AlterTable
ALTER TABLE "WaitlistSignup" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedByProviderId" TEXT;

-- CreateTable
CREATE TABLE "ProviderSubscription" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "ProviderSubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "isFounder" BOOLEAN NOT NULL DEFAULT false,
    "priceCents" INTEGER NOT NULL DEFAULT 2990,
    "priceLockedUntil" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "nextBillingAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "lastChargeAt" TIMESTAMP(3),
    "lastChargeStatus" TEXT,
    "lastMpPaymentId" TEXT,
    "consecutiveFailedCharges" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSubscription_providerId_key" ON "ProviderSubscription"("providerId");

-- CreateIndex
CREATE INDEX "ProviderSubscription_status_nextBillingAt_idx" ON "ProviderSubscription"("status", "nextBillingAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistSignup_claimedByProviderId_key" ON "WaitlistSignup"("claimedByProviderId");

-- AddForeignKey
ALTER TABLE "ProviderSubscription" ADD CONSTRAINT "ProviderSubscription_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
