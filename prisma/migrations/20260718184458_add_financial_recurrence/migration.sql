-- CreateEnum
CREATE TYPE "FinancialRecurrence" AS ENUM ('RECURRING', 'ONE_TIME');

-- AlterTable
ALTER TABLE "FinancialExpense" ADD COLUMN     "recurrence" "FinancialRecurrence" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN     "recurrenceEndDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FinancialIncome" ADD COLUMN     "recurrence" "FinancialRecurrence" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN     "recurrenceEndDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FinancialStudent" ADD COLUMN     "recurrence" "FinancialRecurrence" NOT NULL DEFAULT 'RECURRING',
ADD COLUMN     "recurrenceEndDate" TIMESTAMP(3),
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
