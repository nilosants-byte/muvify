import "dotenv/config";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { CrefValidationStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { initSocketServer, stopSocketServer } from "../src/realtime/socket";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Épico de Frentes, Frente 9, Lote 9: (1) enviar mensagem de chat usava
// uploadRateLimiter (mensagem de erro sobre "upload") em vez de
// writeRateLimiter; (2) enviar mensagem sempre disparava push pro
// destinatário, mesmo que ele já estivesse com a sala aberta vendo a
// mensagem chegar ao vivo pelo socket.

const password = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
}

function waitFor(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectClient(serverUrl: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(serverUrl, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => reject(error));
  });
}

let serverUrl = "";
let httpServer: ReturnType<typeof createServer> | null = null;
let categoryId = "";
const createdUserIds: string[] = [];
const createdBookingIds: string[] = [];
const createdProviderProfileIds: string[] = [];

async function createClientAndProvider(prefix: string) {
  const phoneBase = Date.now().toString().slice(-7) + Math.floor(Math.random() * 10);

  const clientRegister = await request(app).post("/api/auth/register").send({
    name: `Frente Nove Lote Nove ${prefix} Client`,
    email: uniqueEmail(`f9l9_${prefix}_client`),
    password,
    phone: `11${phoneBase}1`,
    termsVersion: "2026.05",
    consentAccepted: true
  });
  const clientToken = clientRegister.body.accessToken as string;
  const clientId = clientRegister.body.user.id as string;
  await prisma.user.update({ where: { id: clientId }, data: { emailVerifiedAt: new Date() } });

  const providerRegister = await request(app).post("/api/auth/register").send({
    name: `Frente Nove Lote Nove ${prefix} Provider`,
    email: uniqueEmail(`f9l9_${prefix}_provider`),
    password,
    phone: `11${phoneBase}2`,
    role: "PROVIDER",
    termsVersion: "2026.05",
    consentAccepted: true
  });
  const providerToken = providerRegister.body.accessToken as string;
  const providerUserId = providerRegister.body.user.id as string;
  await prisma.user.update({ where: { id: providerUserId }, data: { emailVerifiedAt: new Date() } });

  const profile = await request(app)
    .post("/api/providers/profile")
    .set("Authorization", `Bearer ${providerToken}`)
    .send({
      displayName: `F9L9 ${prefix} Provider`,
      bio: "Profissional de teste",
      experienceYears: 1,
      priceCents: 10000,
      categoryIds: [categoryId]
    });
  const providerProfileId = profile.body.id as string;
  await prisma.providerProfile.update({
    where: { id: providerProfileId },
    data: {
      crefValidationStatus: CrefValidationStatus.APPROVED,
      crefValidatedAt: new Date(),
      crefReviewedAt: new Date()
    }
  });

  const booking = await prisma.booking.create({
    data: {
      clientId,
      providerId: providerProfileId,
      categoryId,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      priceCents: 10000
    }
  });

  createdUserIds.push(clientId, providerUserId);
  createdProviderProfileIds.push(providerProfileId);
  createdBookingIds.push(booking.id);

  return { clientToken, clientId, providerToken, providerUserId, providerProfileId, bookingId: booking.id };
}

describe("Frente 9, Lote 9 — rate limit do chat e push duplicado", () => {
  beforeAll(async () => {
    await prisma.$connect();

    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
    const { port } = httpServer!.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${port}`;
    await initSocketServer(httpServer);

    const category = await prisma.serviceCategory.create({
      data: { name: `F9L9_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await stopSocketServer();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await prisma.bookingMessage.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: createdProviderProfileIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("bloqueio de excesso de mensagens usa a mensagem do writeRateLimiter, não a de upload", async () => {
    const fixture = await createClientAndProvider("rate");
    let lastResponse: request.Response | null = null;
    for (let i = 0; i < 21; i += 1) {
      lastResponse = await request(app)
        .post(`/api/bookings/${fixture.bookingId}/messages`)
        .set("Authorization", `Bearer ${fixture.clientToken}`)
        .send({ content: `Mensagem ${i}` });
    }
    expect(lastResponse!.status).toBe(429);
    expect(String(lastResponse!.body.message).toLowerCase()).not.toContain("upload");
    expect(lastResponse!.body.message).toBe("Muitas alterações em pouco tempo. Tente novamente em 1 hora.");
  }, 30000);

  it("não dispara push quando o destinatário já está com a sala do chat aberta", async () => {
    const fixture = await createClientAndProvider("present");
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    const providerSocket = await connectClient(serverUrl, fixture.providerToken);
    try {
      providerSocket.emit("join:booking", fixture.bookingId);
      await waitFor(150);

      const response = await request(app)
        .post(`/api/bookings/${fixture.bookingId}/messages`)
        .set("Authorization", `Bearer ${fixture.clientToken}`)
        .send({ content: "Mensagem com destinatário presente" });
      expect(response.status).toBe(201);

      expect(notifySpy).not.toHaveBeenCalled();
    } finally {
      providerSocket.disconnect();
      notifySpy.mockRestore();
    }
  });

  it("dispara push quando o destinatário não está com a sala do chat aberta", async () => {
    const fixture = await createClientAndProvider("absent");
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    try {
      const response = await request(app)
        .post(`/api/bookings/${fixture.bookingId}/messages`)
        .set("Authorization", `Bearer ${fixture.clientToken}`)
        .send({ content: "Mensagem com destinatário ausente" });
      expect(response.status).toBe(201);

      expect(notifySpy).toHaveBeenCalledWith([fixture.providerUserId], expect.objectContaining({
        data: expect.objectContaining({ type: "CHAT_MESSAGE" })
      }));
    } finally {
      notifySpy.mockRestore();
    }
  });
});
