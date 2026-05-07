-- CreateEnum
CREATE TYPE "FinancialStudentType" AS ENUM ('PRESENTIAL', 'ONLINE', 'APP');

-- CreateEnum
CREATE TYPE "FinancialExpenseCategory" AS ENUM ('GYM', 'TRANSPORT', 'EQUIPMENT', 'MARKETING', 'OTHER');

-- CreateTable
CREATE TABLE "FinancialStudent" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyValueCents" INTEGER NOT NULL,
    "type" "FinancialStudentType" NOT NULL,
    "weeklyFrequency" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialIncome" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "studentId" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialExpense" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "FinancialExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialGoal" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "targetRevenueCents" INTEGER,
    "targetStudents" INTEGER,
    "targetWeeklyClasses" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialClassSession" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "studentId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialClassSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialStudent_providerId_isActive_idx" ON "FinancialStudent"("providerId", "isActive");

-- CreateIndex
CREATE INDEX "FinancialIncome_providerId_paidAt_idx" ON "FinancialIncome"("providerId", "paidAt");

-- CreateIndex
CREATE INDEX "FinancialExpense_providerId_paidAt_idx" ON "FinancialExpense"("providerId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialGoal_providerId_month_key" ON "FinancialGoal"("providerId", "month");

-- CreateIndex
CREATE INDEX "FinancialGoal_providerId_month_idx" ON "FinancialGoal"("providerId", "month");

-- CreateIndex
CREATE INDEX "FinancialClassSession_providerId_date_idx" ON "FinancialClassSession"("providerId", "date");

-- AddForeignKey
ALTER TABLE "FinancialStudent" ADD CONSTRAINT "FinancialStudent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialIncome" ADD CONSTRAINT "FinancialIncome_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialIncome" ADD CONSTRAINT "FinancialIncome_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "FinancialStudent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpense" ADD CONSTRAINT "FinancialExpense_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialGoal" ADD CONSTRAINT "FinancialGoal_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialClassSession" ADD CONSTRAINT "FinancialClassSession_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialClassSession" ADD CONSTRAINT "FinancialClassSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "FinancialStudent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
