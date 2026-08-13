import "dotenv/config";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { CrefValidationStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { initSocketServer, stopSocketServer } from "../src/realtime/socket";

// Frente 14 (segunda camada, carga real), Lote 13: a Home do profissional
// reconsultava a lista COMPLETA de chats a cada 15s só pra manter o badge
// de não lidos — mesmo sem nenhuma mensagem nova. Sala pessoal por usuário
// (`user:<id>`, unida automaticamente ao conectar) + evento leve
// "chat:unread-changed" permitem trocar o polling cego por reação a um
// evento de verdade, SEM exigir que o cliente esteja com a conversa
// específica aberta (diferente de "message:new", escopado à sala do
// booking/consultancy).

const password = "Test1234";

function uniqueEmail(prefix: string) {
  return `${prefix}_f14l13_${Date.now()}@test.com`;
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

function waitFor(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let serverUrl = "";
let httpServer: ReturnType<typeof createServer> | null = null;

let clientToken = "";
let providerToken = "";
let outsiderToken = "";
let clientId = "";
let providerUserId = "";
let outsiderUserId = "";
let providerProfileId = "";
let categoryId = "";
let bookingId = "";

describe("Frente 14, Lote 13 — evento chat:unread-changed chega à sala pessoal do usuário", () => {
  beforeAll(async () => {
    await prisma.$connect();

    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
    const { port } = httpServer!.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${port}`;
    await initSocketServer(httpServer);

    const category = await prisma.serviceCategory.create({
      data: { name: `Categoria_f14l13_${Date.now()}`, description: "F14L13 tests" }
    });
    categoryId = category.id;

    const phoneBase = Date.now().toString().slice(-8);

    const clientRegister = await request(app).post("/api/auth/register").send({
      name: "Cliente Chat Unread",
      email: uniqueEmail("client"),
      password,
      phone: `1177${phoneBase}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    clientToken = clientRegister.body.accessToken;
    clientId = clientRegister.body.user.id;
    await prisma.user.update({ where: { id: clientId }, data: { emailVerifiedAt: new Date() } });

    const providerRegister = await request(app).post("/api/auth/register").send({
      name: "Provider Chat Unread",
      email: uniqueEmail("provider"),
      password,
      phone: `1188${phoneBase}`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    providerToken = providerRegister.body.accessToken;
    providerUserId = providerRegister.body.user.id;
    await prisma.user.update({ where: { id: providerUserId }, data: { emailVerifiedAt: new Date() } });

    const outsiderRegister = await request(app).post("/api/auth/register").send({
      name: "Outsider Chat Unread",
      email: uniqueEmail("outsider"),
      password,
      phone: `1199${phoneBase}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    outsiderToken = outsiderRegister.body.accessToken;
    outsiderUserId = outsiderRegister.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "ProF14L13",
        bio: "Profissional de teste",
        experienceYears: 1,
        priceCents: 10000,
        categoryIds: [categoryId]
      });
    providerProfileId = profile.body.id;

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
    bookingId = booking.id;
  });

  afterAll(async () => {
    await prisma.bookingMessage.deleteMany({ where: { bookingId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerProfileId } });
    await prisma.session.deleteMany({
      where: { userId: { in: [clientId, providerUserId, outsiderUserId] } }
    });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, outsiderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });

    await stopSocketServer();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await prisma.$disconnect();
  });

  it("cliente recebe chat:unread-changed mesmo SEM ter entrado na sala do booking (só conectado)", async () => {
    const clientSocket = await connectClient(serverUrl, clientToken);
    try {
      await waitFor(150); // dá tempo do join automático na sala pessoal acontecer

      const received = new Promise<void>((resolve) => {
        clientSocket.once("chat:unread-changed", () => resolve());
      });

      const response = await request(app)
        .post(`/api/bookings/${bookingId}/messages`)
        .set("Authorization", `Bearer ${providerToken}`)
        .send({ content: "Oi! Confirmando nossa sessão." });
      expect(response.status).toBe(201);

      await received; // não deve travar - falha o teste por timeout se nunca chegar
    } finally {
      clientSocket.disconnect();
    }
  });

  it("quem não participa do booking NÃO recebe chat:unread-changed dessa conversa", async () => {
    const outsiderSocket = await connectClient(serverUrl, outsiderToken);
    try {
      await waitFor(150);

      let receivedAnything = false;
      outsiderSocket.once("chat:unread-changed", () => {
        receivedAnything = true;
      });

      const response = await request(app)
        .post(`/api/bookings/${bookingId}/messages`)
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ content: "Mensagem que o outsider não deveria ver o aviso." });
      expect(response.status).toBe(201);

      await waitFor(300);
      expect(receivedAnything).toBe(false);
    } finally {
      outsiderSocket.disconnect();
    }
  });
});
