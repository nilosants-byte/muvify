import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { onTrainingPlanCompleted } from "../src/modules/gamification/services/gamification-events.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 8:
// o post automático de treino concluído carrega providerName/providerPhotoUrl
// no metadata "para a collab UI no feed", mas o profissional nunca tinha
// nenhuma forma de saber que apareceu no post de um aluno. Decisão do
// usuário: notificação push simples reaproveitando o sistema já existente.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";

describe("Frente 8, Lote 8 — profissional é notificado quando aluno posta sobre o treino com ele", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Oito Lote Oito",
        email: `${uid("f8l8_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Oito Lote Oito",
        email: `${uid("f8l8_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Oito Lote Oito",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({ where: { userId: clientId } });
    await prisma.userXpTransaction.deleteMany({ where: { userId: clientId } });
    await prisma.rankingSnapshot.deleteMany({ where: { userId: clientId } });
    await prisma.userStreak.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("concluir ficha de consultoria notifica o profissional vinculado", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    await onTrainingPlanCompleted(clientId, `completion_${uid("f8l8")}`, providerId);

    const providerCalls = notifySpy.mock.calls.filter(([userIds]) => (userIds as string[]).includes(providerUserId));
    expect(providerCalls.length).toBeGreaterThan(0);
  });

  it("sem profissional vinculado (providerId inexistente), não dispara notificação nenhuma pro profissional", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    await onTrainingPlanCompleted(clientId, `completion_${uid("f8l8_none")}`, "00000000-0000-0000-0000-000000000000");

    const providerCalls = notifySpy.mock.calls.filter(([userIds]) => (userIds as string[]).includes(providerUserId));
    expect(providerCalls.length).toBe(0);
  });
});
