-- CreateEnum
CREATE TYPE "AnamnesisStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateTable
CREATE TABLE "ProviderCalendarEvent" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAnamnesis" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "AnamnesisStatus" NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAnamnesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlanCompletion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "trainingPlanId" TEXT NOT NULL,
    "contractId" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlanCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderCalendarEvent_providerId_startsAt_idx" ON "ProviderCalendarEvent"("providerId", "startsAt");

-- CreateIndex
CREATE INDEX "ProviderCalendarEvent_providerId_endsAt_idx" ON "ProviderCalendarEvent"("providerId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAnamnesis_clientId_key" ON "ClientAnamnesis"("clientId");

-- CreateIndex
CREATE INDEX "ClientAnamnesis_status_idx" ON "ClientAnamnesis"("status");

-- CreateIndex
CREATE INDEX "TrainingPlanCompletion_providerId_completedAt_idx" ON "TrainingPlanCompletion"("providerId", "completedAt");

-- CreateIndex
CREATE INDEX "TrainingPlanCompletion_clientId_completedAt_idx" ON "TrainingPlanCompletion"("clientId", "completedAt");

-- CreateIndex
CREATE INDEX "TrainingPlanCompletion_trainingPlanId_completedAt_idx" ON "TrainingPlanCompletion"("trainingPlanId", "completedAt");

-- AddForeignKey
ALTER TABLE "ProviderCalendarEvent" ADD CONSTRAINT "ProviderCalendarEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAnamnesis" ADD CONSTRAINT "ClientAnamnesis_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanCompletion" ADD CONSTRAINT "TrainingPlanCompletion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanCompletion" ADD CONSTRAINT "TrainingPlanCompletion_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanCompletion" ADD CONSTRAINT "TrainingPlanCompletion_trainingPlanId_fkey" FOREIGN KEY ("trainingPlanId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanCompletion" ADD CONSTRAINT "TrainingPlanCompletion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ConsultancyContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;