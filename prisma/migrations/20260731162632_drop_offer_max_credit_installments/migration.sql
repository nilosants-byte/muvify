-- Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 10:
-- maxCreditInstallments nunca foi lido em lugar nenhum do código nem
-- exposto na API - resquício de uma feature de parcelamento configurável
-- por oferta que foi revertida antes de ser implementada.
ALTER TABLE "ProviderServiceOffer" DROP COLUMN "maxCreditInstallments";
