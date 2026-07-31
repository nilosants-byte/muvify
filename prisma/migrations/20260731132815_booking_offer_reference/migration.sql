-- Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 3: persiste
-- qual oferta (se houver) gerou o booking avulso, pra dar pra reaplicar a
-- restrição de método de pagamento da oferta (acceptsPix/acceptsDebitCard/
-- acceptsCreditCard) na troca de método pré-captura, não só na criação.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "offerId" TEXT;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ProviderServiceOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
