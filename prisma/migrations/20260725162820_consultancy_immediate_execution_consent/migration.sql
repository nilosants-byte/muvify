-- Registra o consentimento expresso do aluno ao inicio imediato do
-- atendimento de consultoria (art. 49 do CDC permite dispensar o direito
-- de arrependimento de 7 dias apos a execucao ja ter comecado, desde que
-- haja consentimento expresso e ciencia da perda do direito).

ALTER TABLE "ConsultancyContract" ADD COLUMN "immediateExecutionAcknowledgedAt" TIMESTAMP(3);
UPDATE "ConsultancyContract" SET "immediateExecutionAcknowledgedAt" = "createdAt" WHERE "immediateExecutionAcknowledgedAt" IS NULL;
ALTER TABLE "ConsultancyContract" ALTER COLUMN "immediateExecutionAcknowledgedAt" SET NOT NULL;
