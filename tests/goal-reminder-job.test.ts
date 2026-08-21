import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { NotificationService } from "../src/modules/notifications/services/notification.service";
import { getWeekKey } from "../src/modules/gamification/services/xp.service";
import { hasMetWeeklyGoal, updateTrainingDaysConfig } from "../src/modules/gamification/services/streak.service";
import { sendDailyTrainingReminders, sendWeeklyGoalSetupNudges } from "../src/modules/gamification/jobs/goal-reminder.job";

// Segunda camada: lembrete diário de treino (só quem configurou meta
// semanal de propósito) e nudge semanal sugerindo configurar meta pra quem
// nunca mexeu nisso. `now` é sempre construído como um horário UTC que cai
// à tarde em America/Sao_Paulo (UTC-3, sem horário de verão hoje em dia),
// pra exercitar o portão de "só depois do meio-dia local" de forma
// determinística.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function afternoonLocal(): Date {
  // 18:00 UTC = 15:00 em America/Sao_Paulo (UTC-3) - depois do meio-dia.
  const d = new Date();
  d.setUTCHours(18, 0, 0, 0);
  return d;
}

function morningLocal(): Date {
  // 10:00 UTC = 07:00 em America/Sao_Paulo (UTC-3) - antes do meio-dia.
  const d = new Date();
  d.setUTCHours(10, 0, 0, 0);
  return d;
}

const createdUserIds: string[] = [];

async function makeUser(role: "CLIENT" | "PROVIDER", overrides: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      name: `Goal Reminder ${role}`,
      email: `${uid("goal")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role,
      ...overrides
    }
  });
  createdUserIds.push(user.id);
  return user;
}

describe("hasMetWeeklyGoal", () => {
  it("streak nulo: não bateu meta", () => {
    expect(hasMetWeeklyGoal(null, "2026-08-17")).toBe(false);
  });

  it("weekKey bate com a semana corrente e dias treinados >= meta: bateu", () => {
    expect(
      hasMetWeeklyGoal({ weekKey: "2026-08-17", daysTrainedThisWeek: 3, trainingDaysPerWeek: 3 }, "2026-08-17")
    ).toBe(true);
  });

  it("weekKey bate mas dias treinados < meta: não bateu", () => {
    expect(
      hasMetWeeklyGoal({ weekKey: "2026-08-17", daysTrainedThisWeek: 2, trainingDaysPerWeek: 3 }, "2026-08-17")
    ).toBe(false);
  });

  it("weekKey é de uma semana antiga (usuário não treinou ainda nesta semana): não bateu, mesmo com contador alto de uma semana passada", () => {
    expect(
      hasMetWeeklyGoal({ weekKey: "2026-08-03", daysTrainedThisWeek: 7, trainingDaysPerWeek: 3 }, "2026-08-17")
    ).toBe(false);
  });
});

describe("updateTrainingDaysConfig marca weeklyGoalConfiguredAt", () => {
  afterAll(async () => {
    await prisma.userStreak.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("primeira configuração de meta preenche weeklyGoalConfiguredAt (antes null)", async () => {
    const user = await makeUser("CLIENT");
    expect(user.trainingDaysPerWeek).toBe(3);

    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(before.weeklyGoalConfiguredAt).toBeNull();

    await updateTrainingDaysConfig(user.id, 5);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.trainingDaysPerWeek).toBe(5);
    expect(after.weeklyGoalConfiguredAt).not.toBeNull();
  });
});

describe("goal-reminder.job", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.userStreak.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  describe("sendDailyTrainingReminders", () => {
    it("cliente com meta configurada, nunca treinou: recebe lembrete à tarde", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = afternoonLocal();
      const user = await makeUser("CLIENT", { weeklyGoalConfiguredAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) });

      await sendDailyTrainingReminders(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeDefined();
      expect((call![1] as any).data.type).toBe("DAILY_TRAINING_REMINDER");

      const fromDb = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(fromDb.lastGoalReminderSentAt?.getTime()).toBe(now.getTime());
    });

    it("cliente sem meta configurada: não recebe lembrete diário", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = afternoonLocal();
      const user = await makeUser("CLIENT");

      await sendDailyTrainingReminders(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();
    });

    it("cliente já treinou hoje: não recebe lembrete", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = afternoonLocal();
      const user = await makeUser("CLIENT", { weeklyGoalConfiguredAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) });
      await prisma.userStreak.create({
        data: { userId: user.id, currentStreak: 1, longestStreak: 1, lastTrainingDate: now, trainingDaysPerWeek: 3 }
      });

      await sendDailyTrainingReminders(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();
    });

    it("cliente já bateu a meta da semana: não recebe lembrete, mesmo sem treinar hoje", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = afternoonLocal();
      const weekKey = getWeekKey(now);
      const user = await makeUser("CLIENT", { weeklyGoalConfiguredAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) });
      await prisma.userStreak.create({
        data: {
          userId: user.id,
          currentStreak: 3,
          longestStreak: 3,
          lastTrainingDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          trainingDaysPerWeek: 3,
          weekKey,
          daysTrainedThisWeek: 3
        }
      });

      await sendDailyTrainingReminders(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();
    });

    it("antes do meio-dia local: ninguém recebe lembrete, mesmo elegível", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = morningLocal();
      const user = await makeUser("CLIENT", { weeklyGoalConfiguredAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) });

      await sendDailyTrainingReminders(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();

      const fromDb = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(fromDb.lastGoalReminderSentAt).toBeNull();
    });

    it("já foi lembrado há poucas horas: não repete (throttle)", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = afternoonLocal();
      const lastSent = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const user = await makeUser("CLIENT", {
        weeklyGoalConfiguredAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        lastGoalReminderSentAt: lastSent
      });

      await sendDailyTrainingReminders(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();

      const fromDb = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(fromDb.lastGoalReminderSentAt?.getTime()).toBe(lastSent.getTime());
    });

    it("profissional (role PROVIDER) nunca recebe, mesmo com meta configurada e sem treinar", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = afternoonLocal();
      const user = await makeUser("PROVIDER", { weeklyGoalConfiguredAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) });

      await sendDailyTrainingReminders(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();
    });
  });

  describe("sendWeeklyGoalSetupNudges", () => {
    it("cliente sem meta configurada, nunca lembrado: recebe o nudge", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const user = await makeUser("CLIENT");

      await sendWeeklyGoalSetupNudges(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeDefined();
      expect((call![1] as any).data.type).toBe("WEEKLY_GOAL_SETUP_NUDGE");

      const fromDb = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(fromDb.lastGoalSetupNudgeSentAt?.getTime()).toBe(now.getTime());
    });

    it("cliente com meta já configurada: não recebe o nudge", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const user = await makeUser("CLIENT", { weeklyGoalConfiguredAt: now });

      await sendWeeklyGoalSetupNudges(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();
    });

    it("já foi lembrado há 2 dias: não repete ainda", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const lastSent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const user = await makeUser("CLIENT", { lastGoalSetupNudgeSentAt: lastSent });

      await sendWeeklyGoalSetupNudges(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();

      const fromDb = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(fromDb.lastGoalSetupNudgeSentAt?.getTime()).toBe(lastSent.getTime());
    });

    it("já foi lembrado há 7 dias: repete", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const user = await makeUser("CLIENT", { lastGoalSetupNudgeSentAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) });

      await sendWeeklyGoalSetupNudges(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeDefined();

      const fromDb = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(fromDb.lastGoalSetupNudgeSentAt?.getTime()).toBe(now.getTime());
    });

    it("profissional (role PROVIDER) nunca recebe o nudge", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const user = await makeUser("PROVIDER");

      await sendWeeklyGoalSetupNudges(now);

      const call = notifySpy.mock.calls.find((c) => (c[0] as string[]).includes(user.id));
      expect(call).toBeUndefined();
    });
  });
});
