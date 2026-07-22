-- Prazo de entrega da consultoria online deixa de ser configuravel por
-- profissional (em dias) e passa a ser fixo em 48 horas para todos, contado
-- a partir da confirmacao do pagamento (ver CONSULTANCY_DELIVERY_DEADLINE_HOURS).

ALTER TABLE "OnlineConsultancySetting" DROP COLUMN "responseSlaDays";

ALTER TABLE "ConsultancyContract" RENAME COLUMN "expiry7dSentAt" TO "expiry24hSentAt";
ALTER TABLE "ConsultancyContract" RENAME COLUMN "expiry1dSentAt" TO "expiry6hSentAt";
