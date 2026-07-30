import { dateKeyInAppTimezone, isCurrentWeekInAppTimezone, isTodayInAppTimezone } from "../utils/formatters";
import { expandRangeToQuarterHours } from "../utils/agendaFreeSlots";

// Frente 5 (Descoberta, agendamento e agenda), Lote 12:
// (1) isToday/isCurrentWeek passam a usar o fuso do app (America/Sao_Paulo)
//     em vez do fuso local do aparelho.
// (2) TimeWheelPicker recebe o intervalo inteiro ocupado (não só os
//     extremos) — expandRangeToQuarterHours cobre esse cálculo.

describe("Frente 5, Lote 12 — helpers de data/hora com fuso do app", () => {
  it("isTodayInAppTimezone: verdadeiro pra agora, falso pra +2 dias e -2 dias", () => {
    const now = new Date();
    expect(isTodayInAppTimezone(now.toISOString())).toBe(true);

    const twoDaysAhead = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(isTodayInAppTimezone(twoDaysAhead.toISOString())).toBe(false);

    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(isTodayInAppTimezone(twoDaysAgo.toISOString())).toBe(false);
  });

  it("isTodayInAppTimezone: null/undefined/data inválida retornam falso", () => {
    expect(isTodayInAppTimezone(null)).toBe(false);
    expect(isTodayInAppTimezone(undefined)).toBe(false);
    expect(isTodayInAppTimezone("data-invalida")).toBe(false);
  });

  it("dateKeyInAppTimezone: mesmo instante sempre gera a mesma chave, independente de como o offset é escrito", () => {
    const a = dateKeyInAppTimezone(new Date("2026-03-10T14:00:00Z"));
    const b = dateKeyInAppTimezone(new Date("2026-03-10T11:00:00-03:00"));
    expect(a).toBe(b);
  });

  it("isCurrentWeekInAppTimezone: verdadeiro pra agora, falso pra 10 dias no futuro", () => {
    const now = new Date();
    expect(isCurrentWeekInAppTimezone(now.toISOString())).toBe(true);

    const tenDaysAhead = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    expect(isCurrentWeekInAppTimezone(tenDaysAhead.toISOString())).toBe(false);
  });

  it("expandRangeToQuarterHours: cobre todo o intervalo em passos de 15min, incluindo o fim", () => {
    expect(expandRangeToQuarterHours("09:00", "10:00")).toEqual([
      "09:00", "09:15", "09:30", "09:45", "10:00"
    ]);
  });

  it("expandRangeToQuarterHours: intervalo invertido/vazio devolve só os dois extremos informados", () => {
    expect(expandRangeToQuarterHours("10:00", "09:00")).toEqual(["10:00", "09:00"]);
  });
});
