-- Frente 3a do roteiro de seguranca de pagamentos: pagamento de consultoria
-- no cartao passa a ser reserva (capture:false) no aceite, com cobranca de
-- verdade so na entrega da primeira ficha. PIX continua exatamente como
-- funciona hoje (nao existe reserva/hold pra PIX no Mercado Pago).

ALTER TYPE "ConsultancyPaymentStatus" ADD VALUE 'AUTHORIZED';
ALTER TYPE "ConsultancyPaymentStatus" ADD VALUE 'CANCELED';

ALTER TABLE "ConsultancyContract" ADD COLUMN "paymentCanceledAt" TIMESTAMP(3);
