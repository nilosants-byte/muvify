import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { hashValue } from "../src/shared/utils/hash";

// Épico de Frentes, Frente 9, Lote 6: excluir a conta de quem mandou uma
// mensagem de chat anonimizava o BookingMessage, mas a UserNotification já
// entregue ao destinatário (título com o nome do remetente, corpo com um
// trecho da mensagem - ver chat.controller.ts::sendMessage) pertence ao
// destinatário e nunca era tocada.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const userService = new UserService();
const PASSWORD = "Test1234";

let senderId = "";
let recipientId = "";
let providerId = "";
let categoryId = "";
let bookingId = "";
let messageId = "";
let chatNotificationId = "";
let unrelatedNotificationId = "";

describe("Frente 9, Lote 6 — excluir conta anonimiza a notificação de chat no destinatário", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F9L6_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Recipient Provider F9L6",
        email: `${uid("f9l6_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    recipientId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: "F9L6 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f9l6")}`,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const hashedPassword = await hashValue(PASSWORD);
    const clientUser = await prisma.user.create({
      data: {
        name: "Sender Client F9L6",
        email: `${uid("f9l6_client")}@test.com`,
        password: hashedPassword,
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT,
        termsAcceptedAt: new Date(),
        privacyPolicyAcceptedAt: new Date(),
        termsVersion: "2026.05"
      }
    });
    senderId = clientUser.id;

    const booking = await prisma.booking.create({
      data: {
        clientId: senderId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingId = booking.id;

    const message = await prisma.bookingMessage.create({
      data: { bookingId, senderId, content: "Mensagem original que devia sumir" }
    });
    messageId = message.id;

    const chatNotification = await prisma.userNotification.create({
      data: {
        userId: recipientId,
        title: "Sender Client F9L6",
        body: "Mensagem original que devia sumir",
        data: { type: "CHAT_MESSAGE", bookingId, messageId }
      }
    });
    chatNotificationId = chatNotification.id;

    const unrelatedNotification = await prisma.userNotification.create({
      data: {
        userId: recipientId,
        title: "Notificação não relacionada",
        body: "Não deve ser tocada",
        data: { type: "BOOKING_CONFIRMED", bookingId }
      }
    });
    unrelatedNotificationId = unrelatedNotification.id;
  });

  afterAll(async () => {
    await prisma.userNotification.deleteMany({ where: { userId: recipientId } });
    await prisma.bookingMessage.deleteMany({ where: { bookingId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [senderId, recipientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("anonimiza título/corpo da notificação de chat no destinatário, sem apagar o registro nem afetar outras notificações", async () => {
    await userService.deleteMe(senderId, PASSWORD);

    const message = await prisma.bookingMessage.findUnique({ where: { id: messageId } });
    expect(message).not.toBeNull();
    expect(message!.content).toBe("[Mensagem removida]");
    expect(message!.senderId).toBeNull();

    const chatNotification = await prisma.userNotification.findUnique({ where: { id: chatNotificationId } });
    expect(chatNotification).not.toBeNull();
    expect(chatNotification!.userId).toBe(recipientId);
    expect(chatNotification!.title).toBe("Usuário removido");
    expect(chatNotification!.body).toBe("[Mensagem removida]");

    const unrelatedNotification = await prisma.userNotification.findUnique({ where: { id: unrelatedNotificationId } });
    expect(unrelatedNotification).not.toBeNull();
    expect(unrelatedNotification!.title).toBe("Notificação não relacionada");
    expect(unrelatedNotification!.body).toBe("Não deve ser tocada");
  });
});
