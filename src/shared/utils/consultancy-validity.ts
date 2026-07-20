import { OfferBillingCycle } from "@prisma/client";

export function billingCycleDurationDays(cycle: OfferBillingCycle): number {
  if (cycle === OfferBillingCycle.DAILY) return 1;
  if (cycle === OfferBillingCycle.WEEKLY) return 7;
  if (cycle === OfferBillingCycle.MONTHLY) return 30;
  if (cycle === OfferBillingCycle.QUARTERLY) return 90;
  if (cycle === OfferBillingCycle.SEMIANNUAL) return 180;
  return 365;
}

export function consultancyValidUntil(
  contract: { paymentCapturedAt: Date | null; createdAt: Date },
  cycle: OfferBillingCycle
): Date {
  const start = contract.paymentCapturedAt ?? contract.createdAt;
  const validUntil = new Date(start);
  validUntil.setDate(validUntil.getDate() + billingCycleDurationDays(cycle));
  return validUntil;
}
