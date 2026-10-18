import type { OfferBillingCycle } from "../services/api/client";

const CYCLE_UNITS: Record<OfferBillingCycle, [singular: string, plural: string]> = {
  DAILY: ["dia", "dias"],
  WEEKLY: ["semana", "semanas"],
  MONTHLY: ["mês", "meses"],
  QUARTERLY: ["trimestre", "trimestres"],
  SEMIANNUAL: ["semestre", "semestres"],
  ANNUAL: ["ano", "anos"],
};

// Pacote de sessões avulsas (FLEXIBLE_CREDITS): a validade é contada em
// ciclos (billingCycle × presentialTotalCycles), mas nada é cobrado por
// ciclo — por isso vira duração por extenso ("1 mês", "3 meses") em vez de
// "1 mensal(s)" / "R$ X / mensal", que fazia parecer uma assinatura.
export function cycleDurationLabel(cycle: OfferBillingCycle, count: number): string {
  const [singular, plural] = CYCLE_UNITS[cycle] ?? ["ciclo", "ciclos"];
  return `${count} ${count === 1 ? singular : plural}`;
}

export function cycleUnitPlural(cycle: OfferBillingCycle): string {
  return (CYCLE_UNITS[cycle] ?? ["ciclo", "ciclos"])[1];
}
