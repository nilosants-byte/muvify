-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "crefSubmittedAt" TIMESTAMP(3);

-- Backfill: perfis que já têm CREF (qualquer status) nunca tiveram esse
-- campo até agora - usa createdAt como aproximação razoável da submissão
-- original, pra fila continuar ordenável de forma justa sem tratar todo
-- o histórico existente como "acabou de chegar".
UPDATE "ProviderProfile" SET "crefSubmittedAt" = "createdAt" WHERE "crefNumber" IS NOT NULL;
