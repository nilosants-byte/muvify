import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { CrefValidationStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Épico de Frentes, Frente 9, Lote 19: limpeza final.
// (1) rota de chat de agendamento não deixa mais ADMIN passar do
//     middleware de role (sem efeito real antes - nenhum controller
//     autoriza por role, só por clientId/providerId).
// (2) mensagem nova de chat (agendamento e consultoria) usa a categoria
//     própria CHAT, não mais BOOKINGS/CONSULTANCY emprestadas.
// (3) GET /notifications/inbox aceita skip - lista deixa de ter um take
//     fixo sem forma de buscar itens mais antigos.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

let categoryId = "";
let clientToken = "";
let clientId = "";
let providerToken = "";
let providerUserId = "";
let providerProfileId = "";
let bookingId = "";
const createdUserIds: string[] = [];
const createdBookingIds: string[] = [];
const createdProviderProfileIds: string[] = [];

describe("Frente 9, Lote 19 — limpeza final", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F9L19_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const phoneBase = Date.now().toString().slice(-8);

    const clientRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Nove Lote Dezenove Client",
      email: uniqueEmail("f9l19_client"),
      password: PASSWORD,
      phone: `1177${phoneBase}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    clientToken = clientRegister.body.accessToken;
    clientId = clientRegister.body.user.id;
    await prisma.user.update({ where: { id: clientId }, data: { emailVerifiedAt: new Date() } });
    createdUserIds.push(clientId);

    const providerRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Nove Lote Dezenove Provider",
      email: uniqueEmail("f9l19_provider"),
      password: PASSWORD,
      phone: `1188${phoneBase}`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    providerToken = providerRegister.body.accessToken;
    providerUserId = providerRegister.body.user.id;
    await prisma.user.update({ where: { id: providerUserId }, data: { emailVerifiedAt: new Date() } });
    createdUserIds.push(providerUserId);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "F9L19 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f9l19")}`,
        crefValidationStatus: CrefValidationStatus.APPROVED
      }
    });
    providerProfileId = provider.id;
    createdProviderProfileIds.push(providerProfileId);

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId: providerProfileId,
        categoryId,
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priceCents: 10000
      }
    });
    bookingId = booking.id;
    createdBookingIds.push(bookingId);
  });

  afterAll(async () => {
    await prisma.bookingMessage.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: createdProviderProfileIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  describe("ADMIN sem efeito real na rota de chat", () => {
    it("ADMIN autenticado é rejeitado com 403 antes de chegar no controller (antes retornava 200 com lista vazia)", async () => {
      const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
      const adminReg = await request(app).post("/api/auth/register").send({
        name: "Frente Nove Lote Dezenove Admin",
        email: adminEmail,
        password: PASSWORD,
        phone: `1199${Date.now().toString().slice(-8)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
      const adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
      await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
      const adminLogin = await request(app).post("/api/auth/login").send({ email: adminEmail, password: PASSWORD });
      const adminToken = adminLogin.body.accessToken as string;

      const response = await request(app)
        .get("/api/bookings/me/chats")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe("mensagem de chat usa categoria própria CHAT", () => {
    it("enviar mensagem de agendamento passa preferenceType CHAT (não BOOKINGS)", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      try {
        const response = await request(app)
          .post(`/api/bookings/${bookingId}/messages`)
          .set("Authorization", `Bearer ${clientToken}`)
          .send({ content: "Mensagem de teste do Lote 19" });
        expect(response.status).toBe(201);

        expect(notifySpy).toHaveBeenCalledWith([providerUserId], expect.objectContaining({
          preferenceType: "CHAT",
          data: expect.objectContaining({ type: "CHAT_MESSAGE" })
        }));
      } finally {
        notifySpy.mockRestore();
      }
    });
  });

  describe("paginação real da caixa de notificações", () => {
    it("skip pula os itens já retornados na página anterior, sem duplicar nem repetir", async () => {
      await prisma.userNotification.deleteMany({ where: { userId: clientId } });
      const titles = Array.from({ length: 5 }, (_, i) => `F9L19 Notif ${i}`);
      for (const title of titles) {
        await prisma.userNotification.create({
          data: { userId: clientId, title, body: "corpo", data: {} }
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const firstPage = await request(app)
        .get("/api/notifications/inbox?take=2&skip=0")
        .set("Authorization", `Bearer ${clientToken}`);
      expect(firstPage.status).toBe(200);
      expect(firstPage.body).toHaveLength(2);

      const secondPage = await request(app)
        .get("/api/notifications/inbox?take=2&skip=2")
        .set("Authorization", `Bearer ${clientToken}`);
      expect(secondPage.status).toBe(200);
      expect(secondPage.body).toHaveLength(2);

      const firstIds = firstPage.body.map((item: { id: string }) => item.id);
      const secondIds = secondPage.body.map((item: { id: string }) => item.id);
      const overlap = firstIds.filter((id: string) => secondIds.includes(id));
      expect(overlap).toHaveLength(0);

      const thirdPage = await request(app)
        .get("/api/notifications/inbox?take=2&skip=4")
        .set("Authorization", `Bearer ${clientToken}`);
      expect(thirdPage.status).toBe(200);
      expect(thirdPage.body).toHaveLength(1);
    });
  });
});
