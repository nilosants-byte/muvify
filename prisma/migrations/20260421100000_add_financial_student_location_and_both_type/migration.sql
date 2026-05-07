-- Add BOTH to FinancialStudentType enum
ALTER TYPE "FinancialStudentType" ADD VALUE IF NOT EXISTS 'BOTH';

-- Add location field to FinancialStudent
ALTER TABLE "FinancialStudent" ADD COLUMN IF NOT EXISTS "location" TEXT;
