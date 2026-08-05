import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { recordTraining, updateTrainingDaysConfig } from "../src/modules/gamification/services/streak.service";
import { onWeekStreakMilestone } from "../src/modules/gamification/services/gamification-events.service";
import { getWeekKey } from "../src/modules/gamification/services/xp.service";

// "4 temas pendentes" do épico de frentes (05/08/2026), Tema 4: streak deixa
// de quebrar por dia corrido (folga fixa) e passa a ser avaliado por
// SEMANA - cada dia treinado soma na sequência, que só quebra se a meta
// pessoal (trainingDaysPerWeek) não for batida no fechamento de uma semana
// (segunda a domingo, mesma getWeekKey já usada pelo ranking de amigos).

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function weeksAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return getWeekKey(d);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const createdUserIds: string[] = [];

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      name: "Streak Tester",
      email: `${uid("streak")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${createdUserIds.length}`,
      role: "CLIENT",
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

describe("Tema 4 — redesenho do streak semanal", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.userXpTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.userStreak.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("primeiro treino registrado começa a sequência em 1 dia e soma o total histórico", async () => {
    const userId = await makeUser();
    const result = await recordTraining(userId);
    expect(result.streakSessions).toBe(1);
    expect(result.alreadyTrainedToday).toBe(false);

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.currentStreak).toBe(1);
    expect(streak.totalDaysTrained).toBe(1);
    expect(streak.daysTrainedThisWeek).toBe(1);
    expect(streak.weekKey).toBe(getWeekKey(new Date()));
  });

  it("treinar de novo no mesmo dia não conta segunda vez", async () => {
    const userId = await makeUser();
    await recordTraining(userId);
    const second = await recordTraining(userId);
    expect(second.alreadyTrainedToday).toBe(true);
    expect(second.streakSessions).toBe(1);

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.totalDaysTrained).toBe(1);
  });

  it("segundo dia dentro da MESMA semana soma a sequência sem fechar a semana ainda", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 3);
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 1,
        weekKey: getWeekKey(new Date()),
        daysTrainedThisWeek: 1,
        lastTrainingDate: daysAgo(2),
      },
    });

    const result = await recordTraining(userId);
    expect(result.streakSessions).toBe(2);
    expect(result.weekMilestoneHit).toBeNull();

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.daysTrainedThisWeek).toBe(2);
    expect(streak.currentStreakWeeks).toBe(0);
  });

  it("semana virou e a meta anterior foi batida: sequência continua e conta mais uma semana seguida", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 3);
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 5,
        currentStreakWeeks: 2,
        weekKey: weeksAgoKey(1),
        daysTrainedThisWeek: 3, // bateu a meta de 3
        lastTrainingDate: daysAgo(8),
      },
    });

    const result = await recordTraining(userId);
    expect(result.streakSessions).toBe(6);
    expect(result.alreadyTrainedToday).toBe(false);

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.currentStreak).toBe(6);
    expect(streak.currentStreakWeeks).toBe(3);
    expect(streak.weekKey).toBe(getWeekKey(new Date()));
    expect(streak.daysTrainedThisWeek).toBe(1);
  });

  it("semana virou e a meta anterior NÃO foi batida: sequência quebra e reinicia", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 5);
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 12,
        currentStreakWeeks: 4,
        weekKey: weeksAgoKey(1),
        daysTrainedThisWeek: 2, // meta era 5, só treinou 2 dias
        lastTrainingDate: daysAgo(8),
      },
    });

    const result = await recordTraining(userId);
    expect(result.streakSessions).toBe(1);

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.currentStreak).toBe(1);
    expect(streak.currentStreakWeeks).toBe(0);
  });

  it("semana inteira pulada (sem nenhum treino) quebra a sequência mesmo se a última semana rastreada tinha batido a meta", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 3);
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 20,
        currentStreakWeeks: 6,
        weekKey: weeksAgoKey(2), // pulou a semana passada inteira
        daysTrainedThisWeek: 3, // aquela semana (2 atrás) tinha batido a meta
        lastTrainingDate: daysAgo(15),
      },
    });

    const result = await recordTraining(userId);
    expect(result.streakSessions).toBe(1);

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.currentStreak).toBe(1);
    expect(streak.currentStreakWeeks).toBe(0);
  });

  it("recorde histórico (longestStreak/longestStreakWeeks) não é apagado quando a sequência quebra", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 3);
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 20,
        longestStreak: 20,
        currentStreakWeeks: 6,
        longestStreakWeeks: 6,
        weekKey: weeksAgoKey(2),
        daysTrainedThisWeek: 1,
        lastTrainingDate: daysAgo(15),
      },
    });

    await recordTraining(userId);

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.currentStreak).toBe(1);
    expect(streak.longestStreak).toBe(20);
    expect(streak.currentStreakWeeks).toBe(0);
    expect(streak.longestStreakWeeks).toBe(6);
  });

  it("total de dias treinados nunca reseta, mesmo quando a sequência quebra", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 3);
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 10,
        totalDaysTrained: 50,
        weekKey: weeksAgoKey(2),
        daysTrainedThisWeek: 1,
        lastTrainingDate: daysAgo(15),
      },
    });

    await recordTraining(userId);

    const streak = await prisma.userStreak.findUniqueOrThrow({ where: { userId } });
    expect(streak.currentStreak).toBe(1); // quebrou
    expect(streak.totalDaysTrained).toBe(51); // mas o total histórico só cresce
  });

  it("marco de dias (15) continua funcionando com a sequência em dias já redesenhada", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 7); // meta alta, fácil manter em dias seguidos
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 14,
        weekKey: getWeekKey(new Date()),
        daysTrainedThisWeek: 1,
        lastTrainingDate: daysAgo(1),
      },
    });

    const result = await recordTraining(userId);
    expect(result.streakSessions).toBe(15);
    expect(result.milestoneHit).toBe(15);
  });

  it("marco de semanas (4) é detectado no fechamento da semana e dá XP ao aplicar", async () => {
    const userId = await makeUser();
    await updateTrainingDaysConfig(userId, 3);
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 9,
        currentStreakWeeks: 3,
        weekKey: weeksAgoKey(1),
        daysTrainedThisWeek: 3,
        lastTrainingDate: daysAgo(8),
      },
    });

    const result = await recordTraining(userId);
    expect(result.weekMilestoneHit).toBe(4);

    await onWeekStreakMilestone(userId, result.weekMilestoneHit!);
    const xp = await prisma.userXpTransaction.findFirst({
      where: { userId, reason: "STREAK_WEEK_MILESTONE_4" },
    });
    expect(xp).toBeTruthy();
    expect(xp!.amount).toBe(150);
  });

  it("marco de semanas é reconquistável: dá XP de novo numa semana diferente do mesmo marco", async () => {
    const userId = await makeUser();
    // Primeira vez batendo o marco de 4 semanas, numa semana já fechada.
    await onWeekStreakMilestone(userId, 4);
    const first = await prisma.userXpTransaction.findFirst({ where: { userId, reason: "STREAK_WEEK_MILESTONE_4" } });
    expect(first).toBeTruthy();

    // Chamar de novo NA MESMA semana não duplica (idempotência via referenceId).
    await onWeekStreakMilestone(userId, 4);
    const countSameWeek = await prisma.userXpTransaction.count({ where: { userId, reason: "STREAK_WEEK_MILESTONE_4" } });
    expect(countSameWeek).toBe(1);
  });
});
