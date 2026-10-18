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

// Mesma regra do servidor (src/shared/utils/presential-package-schedule.ts):
// no pacote de horário fixo o aluno escolhe EXATAMENTE (sessões por ciclo ÷
// semanas do ciclo) horários por semana, no máximo 1 por dia. Semanas
// nominais: mensal = 4, trimestral = 13, semestral = 26, anual = 52.
const CYCLE_DAYS: Record<OfferBillingCycle, number> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 90,
  SEMIANNUAL: 180,
  ANNUAL: 365,
};

export function weeksPerCycle(cycle: OfferBillingCycle): number {
  return Math.round((CYCLE_DAYS[cycle] ?? 30) / 7);
}

export function weeklySlotsForPackage(cycle: OfferBillingCycle, sessionsPerCycle: number): number | null {
  const weeks = weeksPerCycle(cycle);
  if (weeks < 1) return null;
  const slots = sessionsPerCycle / weeks;
  if (!Number.isInteger(slots) || slots < 1 || slots > 7) return null;
  return slots;
}
