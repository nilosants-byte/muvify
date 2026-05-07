-- AlterTable
ALTER TABLE "ProviderProfile"
ADD COLUMN "photoUrl" TEXT;

-- CreateEnum
CREATE TYPE "ServiceOfferKind" AS ENUM (
  'PRESENTIAL',
  'ONLINE_CONSULTANCY',
  'ONLINE_CONSULTANCY_SPECIALIZED'
);

-- CreateEnum
CREATE TYPE "OfferBillingCycle" AS ENUM (
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL'
);

-- CreateEnum
CREATE TYPE "ConsultancyRequestStatus" AS ENUM (
  'OPEN',
  'RESPONDED',
  'ACCEPTED',
  'REFUSED',
  'EXPIRED_REFUNDED',
  'ARCHIVED'
);

-- CreateEnum
CREATE TYPE "ConsultancyContractStatus" AS ENUM (
  'PENDING_PAYMENT',
  'ACTIVE',
  'DELIVERED',
  'REFUNDED_EXPIRED',
  'ARCHIVED'
);

-- CreateEnum
CREATE TYPE "ConsultancyPaymentStatus" AS ENUM (
  'PENDING',
  'CAPTURED',
  'REFUNDED',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "ConsultancyPaymentMethod" AS ENUM (
  'CREDIT_CARD',
  'DEBIT_CARD',
  'PIX'
);

-- CreateTable
CREATE TABLE "OnlineConsultancySetting" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "responseSlaDays" INTEGER NOT NULL DEFAULT 7,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnlineConsultancySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderServiceOffer" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "kind" "ServiceOfferKind" NOT NULL,
  "title" TEXT NOT NULL,
  "billingCycle" "OfferBillingCycle" NOT NULL,
  "daysPerWeek" INTEGER,
  "priceCents" INTEGER NOT NULL,
  "isPromotion" BOOLEAN NOT NULL DEFAULT false,
  "promotionLabel" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderServiceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "contractId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "isPrebuilt" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlanExercise" (
  "id" TEXT NOT NULL,
  "trainingPlanId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL,
  "repetitionsSets" TEXT NOT NULL,
  "load" TEXT NOT NULL,
  "restSeconds" INTEGER,
  "restLabel" TEXT,
  "demoVideoUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingPlanExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultancyRequest" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "trainingNeedText" TEXT,
  "limitationText" TEXT,
  "extraInfoText" TEXT,
  "providerResponseText" TEXT,
  "status" "ConsultancyRequestStatus" NOT NULL DEFAULT 'OPEN',
  "quotedOfferId" TEXT,
  "respondedAt" TIMESTAMP(3),
  "clientDecisionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConsultancyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultancyContract" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "status" "ConsultancyContractStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "paymentMethod" "ConsultancyPaymentMethod",
  "paymentStatus" "ConsultancyPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentAmountCents" INTEGER NOT NULL,
  "providerAmountCents" INTEGER NOT NULL,
  "platformAmountCents" INTEGER NOT NULL,
  "paymentCapturedAt" TIMESTAMP(3),
  "deliveryDeadlineAt" TIMESTAMP(3) NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "refundReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConsultancyContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlineConsultancySetting_providerId_key"
ON "OnlineConsultancySetting"("providerId");

-- CreateIndex
CREATE INDEX "ProviderServiceOffer_providerId_isActive_idx"
ON "ProviderServiceOffer"("providerId", "isActive");

-- CreateIndex
CREATE INDEX "ProviderServiceOffer_isPromotion_isActive_idx"
ON "ProviderServiceOffer"("isPromotion", "isActive");

-- CreateIndex
CREATE INDEX "TrainingPlan_providerId_isPrebuilt_isActive_idx"
ON "TrainingPlan"("providerId", "isPrebuilt", "isActive");

-- CreateIndex
CREATE INDEX "TrainingPlan_contractId_idx"
ON "TrainingPlan"("contractId");

-- CreateIndex
CREATE INDEX "TrainingPlanExercise_trainingPlanId_sortOrder_idx"
ON "TrainingPlanExercise"("trainingPlanId", "sortOrder");

-- CreateIndex
CREATE INDEX "ConsultancyRequest_providerId_status_createdAt_idx"
ON "ConsultancyRequest"("providerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultancyRequest_clientId_status_createdAt_idx"
ON "ConsultancyRequest"("clientId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultancyContract_requestId_key"
ON "ConsultancyContract"("requestId");

-- CreateIndex
CREATE INDEX "ConsultancyContract_providerId_status_deliveryDeadlineAt_idx"
ON "ConsultancyContract"("providerId", "status", "deliveryDeadlineAt");

-- CreateIndex
CREATE INDEX "ConsultancyContract_clientId_status_createdAt_idx"
ON "ConsultancyContract"("clientId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "OnlineConsultancySetting"
ADD CONSTRAINT "OnlineConsultancySetting_providerId_fkey"
FOREIGN KEY ("providerId")
REFERENCES "ProviderProfile"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderServiceOffer"
ADD CONSTRAINT "ProviderServiceOffer_providerId_fkey"
FOREIGN KEY ("providerId")
REFERENCES "ProviderProfile"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan"
ADD CONSTRAINT "TrainingPlan_providerId_fkey"
FOREIGN KEY ("providerId")
REFERENCES "ProviderProfile"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan"
ADD CONSTRAINT "TrainingPlan_contractId_fkey"
FOREIGN KEY ("contractId")
REFERENCES "ConsultancyContract"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanExercise"
ADD CONSTRAINT "TrainingPlanExercise_trainingPlanId_fkey"
FOREIGN KEY ("trainingPlanId")
REFERENCES "TrainingPlan"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyRequest"
ADD CONSTRAINT "ConsultancyRequest_providerId_fkey"
FOREIGN KEY ("providerId")
REFERENCES "ProviderProfile"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyRequest"
ADD CONSTRAINT "ConsultancyRequest_clientId_fkey"
FOREIGN KEY ("clientId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyRequest"
ADD CONSTRAINT "ConsultancyRequest_quotedOfferId_fkey"
FOREIGN KEY ("quotedOfferId")
REFERENCES "ProviderServiceOffer"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyContract"
ADD CONSTRAINT "ConsultancyContract_requestId_fkey"
FOREIGN KEY ("requestId")
REFERENCES "ConsultancyRequest"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyContract"
ADD CONSTRAINT "ConsultancyContract_providerId_fkey"
FOREIGN KEY ("providerId")
REFERENCES "ProviderProfile"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyContract"
ADD CONSTRAINT "ConsultancyContract_clientId_fkey"
FOREIGN KEY ("clientId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyContract"
ADD CONSTRAINT "ConsultancyContract_offerId_fkey"
FOREIGN KEY ("offerId")
REFERENCES "ProviderServiceOffer"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
