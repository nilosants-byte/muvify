import { OfferBillingCycle } from "@prisma/client";
import { billingCycleDurationDays } from "./consultancy-validity";

// Achado no teste manual do checklist (C6.1, 18/10/2026): no pacote de
// horário fixo, o aluno podia escolher quantos horários quisesse por semana
// (inclusive vários no mesmo dia) e a geração de aulas criava uma sessão por
// horário em toda semana do ciclo — 9 horários num pacote de 4 sessões/mês
// viravam ~39 aulas pelo preço de 4. Decisão do Danilo: o pacote define o
// número EXATO de horários por semana (sessões por ciclo ÷ semanas do ciclo),
// no máximo 1 por dia.
//
// Semanas "nominais" do ciclo: mensal = 4, trimestral = 13, semestral = 26,
// anual = 52 (arredondando a duração em dias). Diário não comporta horário
// semanal fixo.
export function weeksPerCycle(cycle: OfferBillingCycle): number {
  return Math.round(billingCycleDurationDays(cycle) / 7);
}

// Quantos horários por semana o pacote cobre — null quando as sessões por
// ciclo não viram um número inteiro de aulas por semana entre 1 e 7 (oferta
// mal configurada; o cadastro já barra isso, ver validateOfferInput).
export function weeklySlotsForPackage(cycle: OfferBillingCycle, sessionsPerCycle: number): number | null {
  const weeks = weeksPerCycle(cycle);
  if (weeks < 1) return null;
  const slots = sessionsPerCycle / weeks;
  if (!Number.isInteger(slots) || slots < 1 || slots > 7) return null;
  return slots;
}
