-- AlterTable
ALTER TABLE "CompletionEvidence" ADD COLUMN     "storageKey" TEXT,
ALTER COLUMN "imageBase64" DROP NOT NULL;
