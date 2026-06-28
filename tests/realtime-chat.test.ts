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

const password = "Test1234";

function uniqueEmail(prefix: string) {
  return `${prefix}_rt_${Date.now()}@test.com`;
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

function connectClient(token: string): Promise<ClientSocket> {
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

describe("realtime-chat", () => {
  beforeAll(async () => {
    await prisma.$connect();

    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
    const { port } = httpServer!.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${port}`;
    await initSocketServer(httpServer);

    const category = await prisma.serviceCategory.create({
      data: { name: `Categoria_rt_${Date.now()}`, description: "Realtime tests" }
    });
    categoryId = category.id;

    const phoneBase = Date.now().toString().slice(-8);

    const clientRegister = await request(app).post("/api/auth/register").send({
      name: "ClientRT",
      email: uniqueEmail("client"),
      password,
      phone: `1177${phoneBase}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    clientToken = clientRegister.body.accessToken;
    clientId = clientRegister.body.user.id;

    const providerRegister = await request(app).post("/api/auth/register").send({
      name: "ProviderRT",
      email: uniqueEmail("provider"),
      password,
      phone: `1188${phoneBase}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    providerToken = providerRegister.body.accessToken;
    providerUserId = providerRegister.body.user.id;

    const outsiderRegister = await request(app).post("/api/auth/register").send({
      name: "OutsiderRT",
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
        displayName: "ProRT",
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
    await prisma.user.deleteMany({
      where: { id: { in: [clientId, providerUserId, outsiderUserId] } }
    });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });

    await stopSocketServer();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await prisma.$disconnect();
  });

  it("rejeita conexao sem token", async () => {
    await expect(connectClient("")).rejects.toBeTruthy();
  });

  it("entrega mensagem nova em tempo real para quem participa do agendamento", async () => {
    const clientSocket = await connectClient(clientToken);
    try {
      clientSocket.emit("join:booking", bookingId);
      await waitFor(150);

      const received = new Promise<{ content: string }>((resolve) => {
        clientSocket.once("message:new", resolve);
      });

      const response = await request(app)
        .post(`/api/bookings/${bookingId}/messages`)
        .set("Authorization", `Bearer ${providerToken}`)
        .send({ content: "Ola, tudo bem?" });
      expect(response.status).toBe(201);

      const message = await received;
      expect(message.content).toBe("Ola, tudo bem?");
    } finally {
      clientSocket.disconnect();
    }
  });

  it("nao entrega mensagem para quem nao participa do agendamento", async () => {
    const outsiderSocket = await connectClient(outsiderToken);
    try {
      outsiderSocket.emit("join:booking", bookingId);
      await waitFor(150);

      let receivedAnything = false;
      outsiderSocket.once("message:new", () => {
        receivedAnything = true;
      });

      await request(app)
        .post(`/api/bookings/${bookingId}/messages`)
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ content: "Mensagem que o outsider nao deveria ver" });

      await waitFor(200);
      expect(receivedAnything).toBe(false);
    } finally {
      outsiderSocket.disconnect();
    }
  });
});
