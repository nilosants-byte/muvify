import { OfferBillingCycle } from "@prisma/client";

// Parcelamento no cartão de crédito só faz sentido pra cobranças "de uma vez
// só" — ciclos curtos (mensal, semanal, diário) já são, na prática, uma
// forma de parcelamento (cobrança recorrente periódica); aplicar
// parcelamento de cartão em cima disso duplicaria o conceito e confundiria
// o cliente. Reaproveitado tanto por consultoria quanto por pacote
// presencial, já que os dois usam ProviderServiceOffer.maxCreditInstallments.
const installmentEligibleCycles = new Set<OfferBillingCycle>([
  OfferBillingCycle.QUARTERLY,
  OfferBillingCycle.SEMIANNUAL,
  OfferBillingCycle.ANNUAL
]);

export function supportsInstallments(cycle: OfferBillingCycle) {
  return installmentEligibleCycles.has(cycle);
}

export function resolveMaxInstallments(cycle: OfferBillingCycle, configured: number) {
  if (!supportsInstallments(cycle)) {
    return 1;
  }
  return Math.min(Math.max(configured, 1), 12);
}
