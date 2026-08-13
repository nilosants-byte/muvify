import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CrefValidationStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { processDailyPositionTracker } from "../src/modules/community/jobs/community.jobs";
import { getWeekKey } from "../src/modules/gamification/services/xp.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";
import { hashValue } from "../src/shared/utils/hash";

// Frente 14 (segunda camada, carga real), Lote 2: processDailyPositionTracker
// disparava até 10.000 updates (e outras queries de post/conquista) sem
// nenhum limite de concorrência — mesma classe de problema nos 3 loops de
// lembrete de booking.service.ts, que disparavam sendToUsers sem limite.
// Ambos passaram a processar em lotes de 5 (mesmo padrão já usado em outros
// pontos do código). Estes testes usam mais itens do que o tamanho do lote
// (12 e 7, respectivamente, > 5) pra garantir que processar em múltiplos
// lotes sequenciais ainda cobre TODOS os itens — o risco real de um
// refactor de concorrência é "perder" item na borda entre lotes.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe("Frente 14, Lote 2 — ranking em lote processa todos os itens mesmo em múltiplos lotes de 5", () => {
  const userIds: string[] = [];
  const now = new Date();
  const weekKey = getWeekKey(now);

  beforeAll(async () => {
    await prisma.$connect();

    for (let i = 0; i < 12; i++) {
      const user = await prisma.user.create({
        data: {
          name: `Ranking Teste ${i}`,
          email: `${uid("f14l2")}@test.com`,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
          role: UserRole.CLIENT
        }
      });
      userIds.push(user.id);
    }

    // xpEarned decrescente define o novo ranking (índice 0 = 1º lugar). Os 3
    // primeiros têm lastKnownPosition ANTERIOR pior (mais alto) que a nova
    // posição, pra exercitar o branch de "subiu no ranking" durante o lote.
    await prisma.rankingSnapshot.createMany({
      data: userIds.map((userId, i) => ({
        userId,
        periodType: "WEEKLY",
        periodKey: weekKey,
        xpEarned: 1000 - i * 10,
        lastKnownPosition: i < 3 ? 12 : i + 1
      }))
    });
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rankingSnapshot.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userAchievement.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("atualiza a posição de TODOS os 12 usuários, mesmo processando em múltiplos lotes de 5", async () => {
    await processDailyPositionTracker(now);

    const snapshots = await prisma.rankingSnapshot.findMany({
      where: { userId: { in: userIds }, periodType: "WEEKLY", periodKey: weekKey },
      orderBy: { xpEarned: "desc" }
    });

    expect(snapshots).toHaveLength(12);
    snapshots.forEach((snap, index) => {
      expect(snap.lastKnownPosition).toBe(index + 1);
    });
  });

  it("usuário que subiu de posição durante o processamento em lote ganha o post automático de progresso", async () => {
    const climbedUserId = userIds[0]; // 1º lugar, veio da posição 12 → 1
    const posts = await prisma.feedPost.findMany({
      where: { userId: climbedUserId, type: "RANKING_POSITION_CLIMBED" }
    });
    expect(posts.length).toBeGreaterThan(0);
  });
});

describe("Frente 14, Lote 2 — lembrete de avaliação processa todas as reservas mesmo em múltiplos lotes de 5", () => {
  const bookingService = new BookingService();
  let categoryId = "";
  let clientId = "";
  let providerId = "";
  const createdUserIds: string[] = [];
  const bookingIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: uid("F14L2_cat"), description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente 14 Lote 2 Client",
        email: `${uid("f14l2_client")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    createdUserIds.push(clientId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente 14 Lote 2 Provider",
        email: `${uid("f14l2_provider")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    createdUserIds.push(providerUser.id);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: "F14L2 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f14l2")}`,
        crefValidationStatus: CrefValidationStatus.APPROVED
      }
    });
    providerId = provider.id;

    // 7 reservas concluídas há mais de 24h, sem avaliação — > CONCURRENCY (5),
    // força pelo menos 2 lotes sequenciais numa única chamada do job.
    for (let i = 0; i < 7; i++) {
      const booking = await prisma.booking.create({
        data: {
          clientId,
          providerId,
          categoryId,
          scheduledAt: new Date(Date.now() - (25 + i) * 60 * 60 * 1000),
          priceCents: 10000,
          status: "COMPLETED",
          completedAt: new Date(Date.now() - (25 + i) * 60 * 60 * 1000)
        }
      });
      bookingIds.push(booking.id);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("as 7 reservas recebem o lembrete numa única chamada, nenhuma perdida na borda entre lotes", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as never);

    await bookingService.sendReviewReminders();

    const stored = await prisma.booking.findMany({ where: { id: { in: bookingIds } } });
    expect(stored).toHaveLength(7);
    for (const booking of stored) {
      expect(booking.reviewReminderSentAt).not.toBeNull();
    }
    for (const bookingId of bookingIds) {
      expect(notifySpy).toHaveBeenCalledWith(
        [clientId],
        expect.objectContaining({ data: expect.objectContaining({ type: "REVIEW_REMINDER", bookingId }) })
      );
    }
  });
});
