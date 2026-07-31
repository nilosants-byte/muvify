-- Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 2:
-- congela billingCycle/kind/fichaValidityDays da oferta no momento da
-- compra do contrato de consultoria, mesma proteção que PresentialPackage
-- já tinha pros campos equivalentes. Colunas adicionadas como opcionais,
-- backfilled a partir da oferta atualmente vinculada, e só então marcadas
-- NOT NULL (billingCycle/kind) — fichaValidityDays continua opcional (a
-- própria oferta permite null).

-- AlterTable
ALTER TABLE "ConsultancyContract" ADD COLUMN "billingCycle" "OfferBillingCycle";
ALTER TABLE "ConsultancyContract" ADD COLUMN "kind" "ServiceOfferKind";
ALTER TABLE "ConsultancyContract" ADD COLUMN "fichaValidityDays" INTEGER;

-- Backfill a partir da oferta vinculada no momento da migração.
UPDATE "ConsultancyContract" c
SET "billingCycle" = o."billingCycle",
    "kind" = o."kind",
    "fichaValidityDays" = o."fichaValidityDays"
FROM "ProviderServiceOffer" o
WHERE c."offerId" = o."id";

ALTER TABLE "ConsultancyContract" ALTER COLUMN "billingCycle" SET NOT NULL;
ALTER TABLE "ConsultancyContract" ALTER COLUMN "kind" SET NOT NULL;
