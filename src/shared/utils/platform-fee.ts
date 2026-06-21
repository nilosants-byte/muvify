const PROVIDER_SPLIT_PERCENT = 90;
const PLATFORM_COMMISSION_PERCENT = 10;

export function platformFeeAmount(amountCents: number): number {
  if (amountCents < 0) throw new Error(`platformFeeAmount: amountCents cannot be negative (got ${amountCents})`);
  return Math.round(amountCents * (PLATFORM_COMMISSION_PERCENT / 100));
}

export function providerSplitAmount(amountCents: number): number {
  if (amountCents < 0) throw new Error(`providerSplitAmount: amountCents cannot be negative (got ${amountCents})`);
  return amountCents - platformFeeAmount(amountCents);
}
