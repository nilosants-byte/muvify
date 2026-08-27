-- CreateEnum
CREATE TYPE "ConsultancyContractOrigin" AS ENUM ('MARKETPLACE', 'EXTERNAL');

-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN     "origin" "ConsultancyContractOrigin" NOT NULL DEFAULT 'MARKETPLACE';
