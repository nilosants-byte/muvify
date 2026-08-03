import "dotenv/config";
import { describe, it, expect } from "vitest";
import { getWeekKey, getMonthKey } from "../src/modules/gamification/services/xp.service";
import { getPreviousWeekKey, getPreviousMonthKey, localDateKey } from "../src/modules/community/jobs/community.jobs";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 4:
// getWeekKey/getMonthKey (xp.service.ts) já calculam a chave do período
// certinho em APP_TIMEZONE (America/Sao_Paulo), mas o job que fecha o
// período (getPreviousWeekKey/getPreviousMonthKey e o gatilho de
// dayOfWeek/dayOfMonth) usava aritmética de Date crua (fuso do processo) -
// perto da virada de dia/mês em UTC vs. BRT (21h-23h59 no horário de
// Brasília), a chave fechada pelo job podia divergir da chave realmente
// usada durante o período pra acumular XP.

describe("Frente 8, Lote 4 — job de ranking fecha o período correto perto da virada UTC/BRT", () => {
  it("localDateKey usa o fuso do app, não UTC - 23h30 de sexta em BRT ainda não é sábado", () => {
    // 2026-08-08T02:30:00Z = 2026-08-07T23:30:00 em America/Sao_Paulo (UTC-3):
    // ainda sexta-feira no fuso do app, já sábado em UTC.
    const instant = new Date("2026-08-08T02:30:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-08-08"); // UTC "veria" sábado
    expect(localDateKey(instant)).toBe("2026-08-07"); // fuso do app: ainda sexta
  });

  it("getPreviousWeekKey é sempre exatamente 7 dias antes da chave da semana corrente, em qualquer instante", () => {
    const instants = [
      new Date("2026-08-08T02:30:00Z"), // sexta 23h30 BRT / sábado UTC
      new Date("2026-01-01T01:00:00Z"), // virada de ano, perto da meia-noite BRT
      new Date("2026-06-15T12:00:00Z"), // meio do dia, sem ambiguidade
    ];
    for (const now of instants) {
      const currentWeekKey = getWeekKey(now);
      const prevWeekKey = getPreviousWeekKey(now);
      const expected = new Date(`${currentWeekKey}T12:00:00Z`);
      expected.setUTCDate(expected.getUTCDate() - 7);
      expect(prevWeekKey).toBe(expected.toISOString().slice(0, 10));
    }
  });

  it("getPreviousMonthKey é sempre o mês anterior ao mês corrente (fuso-aware), mesmo perto da virada de mês em UTC", () => {
    // 2026-08-01T02:30:00Z = 2026-07-31T23:30:00 em BRT: ainda julho no fuso
    // do app, já agosto em UTC - o mês "corrente" certo aqui é julho, e o
    // anterior deve ser junho (não julho, que seria o resultado se a conta
    // rodasse contra agosto/UTC por engano).
    const instant = new Date("2026-08-01T02:30:00Z");
    expect(getMonthKey(instant)).toBe("2026-07");
    expect(getPreviousMonthKey(instant)).toBe("2026-06");
  });

  it("getPreviousMonthKey lida com virada de ano corretamente", () => {
    const instant = new Date("2026-01-15T12:00:00Z");
    expect(getMonthKey(instant)).toBe("2026-01");
    expect(getPreviousMonthKey(instant)).toBe("2025-12");
  });
});
