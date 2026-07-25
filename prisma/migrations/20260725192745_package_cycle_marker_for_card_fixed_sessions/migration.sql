-- Frente 3b.2 do roteiro de seguranca de pagamentos: pacote presencial de
-- horario fixo pago em cartao passa a cobrar sessao por sessao (mesmo motor
-- da sessao avulsa), em vez de uma cobranca unica por ciclo. Pix e o formato
-- de creditos flexiveis continuam com a cobranca por ciclo, entao os campos
-- de pagamento do ciclo viram opcionais (em vez de sumirem).

ALTER TABLE "PresentialPackageCycle" ALTER COLUMN "amountCents" DROP NOT NULL;
ALTER TABLE "PresentialPackageCycle" ALTER COLUMN "providerAmountCents" DROP NOT NULL;
ALTER TABLE "PresentialPackageCycle" ALTER COLUMN "platformAmountCents" DROP NOT NULL;
ALTER TABLE "PresentialPackageCycle" ALTER COLUMN "capturedAt" DROP NOT NULL;
ALTER TABLE "PresentialPackageCycle" ALTER COLUMN "capturedAt" DROP DEFAULT;
