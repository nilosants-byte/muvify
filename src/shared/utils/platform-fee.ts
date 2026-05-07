const PROVIDER_SPLIT_PERCENT = 90;
const PLATFORM_COMMISSION_PERCENT = 10;

export function platformFeeAmount(amountCents: number): number {
  return Math.round(amountCents * (PLATFORM_COMMISSION_PERCENT / 100));
}

export function providerSplitAmount(amountCents: number): number {
  return amountCents - platformFeeAmount(amountCents);
}
