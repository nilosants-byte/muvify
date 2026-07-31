import { OfferBillingCycle } from "@prisma/client";

export function billingCycleDurationDays(cycle: OfferBillingCycle): number {
  if (cycle === OfferBillingCycle.DAILY) return 1;
  if (cycle === OfferBillingCycle.WEEKLY) return 7;
  if (cycle === OfferBillingCycle.MONTHLY) return 30;
  if (cycle === OfferBillingCycle.QUARTERLY) return 90;
  if (cycle === OfferBillingCycle.SEMIANNUAL) return 180;
  return 365;
}

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 2: recebe o
// billingCycle congelado no próprio contrato (não mais lido ao vivo de
// contract.offer.billingCycle) — editar a oferta depois da venda não pode
// mais mudar retroativamente a vigência de um contrato já ativo.
export function consultancyValidUntil(
  contract: { paymentCapturedAt: Date | null; createdAt: Date; billingCycle: OfferBillingCycle }
): Date {
  const start = contract.paymentCapturedAt ?? contract.createdAt;
  const validUntil = new Date(start);
  validUntil.setDate(validUntil.getDate() + billingCycleDurationDays(contract.billingCycle));
  return validUntil;
}
