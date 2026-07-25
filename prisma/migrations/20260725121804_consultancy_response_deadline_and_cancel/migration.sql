-- Prazo de 48h pro personal responder uma solicitacao de consultoria (auto
-- expira sem resposta) e cancelamento da consultoria pelo aluno antes da
-- entrega da primeira ficha (ver CONSULTANCY_DELIVERY_DEADLINE_HOURS).

ALTER TYPE "ConsultancyRequestStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "ConsultancyContractStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "ConsultancyRequest" ADD COLUMN "responseDeadlineAt" TIMESTAMP(3);
UPDATE "ConsultancyRequest" SET "responseDeadlineAt" = "createdAt" + INTERVAL '48 hours' WHERE "responseDeadlineAt" IS NULL;
ALTER TABLE "ConsultancyRequest" ALTER COLUMN "responseDeadlineAt" SET NOT NULL;
