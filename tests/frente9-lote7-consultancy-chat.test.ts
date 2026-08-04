import "dotenv/config";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { initSocketServer, stopSocketServer } from "../src/realtime/socket";

// Épico de Frentes, Frente 9, Lote 7: chat de consultoria (backend) -
// generaliza a mesma infraestrutura do chat de agendamento (autorização
// por participante, socket por sala, isChatOpen equivalente) pra
// ConsultancyContract, com model próprio (ConsultancyMessage).

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

let clientToken = "";
let providerToken = "";
let outsiderToken = "";
let clientId = "";
let providerUserId = "";
let outsiderUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";

async function makeContract(status: "ACTIVE" | "DELIVERED" | "CANCELLED") {
  const consultancyRequest = await prisma.consultancyRequest.create({
    data: {
      providerId,
      clientId,
      status: "ACCEPTED",
      quotedOfferId: offerId,
      responseDeadlineAt: new Date(),
      respondedAt: new Date(),
      clientDecisionAt: new Date()
    }
  });
  return prisma.consultancyContract.create({
    data: {
      requestId: consultancyRequest.id,
      providerId,
      clientId,
      offerId,
      status,
      paymentStatus: "CAPTURED",
      paymentAmountCents: 20000,
      providerAmountCents: 18000,
      platformAmountCents: 2000,
      billingCycle: "MONTHLY",
      kind: "ONLINE_CONSULTANCY",
      deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      immediateExecutionAcknowledgedAt: new Date()
    }
  });
}

describe("Frente 9, Lote 7 — chat de consultoria (backend)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
    const { port } = httpServer!.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${port}`;
    await initSocketServer(httpServer);

    const category = await prisma.serviceCategory.create({
      data: { name: `F9L7_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const phoneBase = Date.now().toString().slice(-8);

    const clientRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Nove Lote Sete Client",
      email: uniqueEmail("f9l7_client"),
      password,
      phone: `1177${phoneBase}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    clientToken = clientRegister.body.accessToken;
    clientId = clientRegister.body.user.id;
    await prisma.user.update({ where: { id: clientId }, data: { emailVerifiedAt: new Date() } });

    const providerRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Nove Lote Sete Provider",
      email: uniqueEmail("f9l7_provider"),
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
      name: "Frente Nove Lote Sete Outsider",
      email: uniqueEmail("f9l7_outsider"),
      password,
      phone: `1199${phoneBase}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    outsiderToken = outsiderRegister.body.accessToken;
    outsiderUserId = outsiderRegister.body.user.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "F9L7 Provider Profile",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f9l7")}`,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria F9L7",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await prisma.consultancyMessage.deleteMany({ where: { contract: { clientId } } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId, outsiderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, outsiderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });

    await stopSocketServer();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await prisma.$disconnect();
  });

  it("cliente e profissional de um contrato ativo trocam mensagens", async () => {
    const contract = await makeContract("ACTIVE");

    const send = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ content: "Oi, dúvida sobre o treino" });
    expect(send.status).toBe(201);
    expect(send.body.content).toBe("Oi, dúvida sobre o treino");

    const reply = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ content: "Claro, pode perguntar" });
    expect(reply.status).toBe(201);

    const messages = await request(app)
      .get(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(messages.status).toBe(200);
    expect(messages.body.isOpen).toBe(true);
    expect(messages.body.messages.length).toBe(2);

    const chats = await request(app)
      .get("/api/consultancy/my/chats")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(chats.status).toBe(200);
    expect(chats.body.some((c: any) => c.contractId === contract.id)).toBe(true);
  });

  it("terceiro não autorizado recebe 404/403", async () => {
    const contract = await makeContract("ACTIVE");

    const sendAsOutsider = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ content: "Não deveria conseguir" });
    expect(sendAsOutsider.status).toBe(403);

    const getAsOutsider = await request(app)
      .get(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(getAsOutsider.status).toBe(403);

    const getInexistent = await request(app)
      .get(`/api/consultancy/contracts/00000000-0000-0000-0000-000000000000/messages`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(getInexistent.status).toBe(404);
  });

  it("contrato cancelado bloqueia mensagem nova, mas mantém histórico legível", async () => {
    const contract = await makeContract("ACTIVE");
    const sendWhileActive = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ content: "Mensagem antes de cancelar" });
    expect(sendWhileActive.status).toBe(201);

    await prisma.consultancyContract.update({ where: { id: contract.id }, data: { status: "CANCELLED" } });

    const sendAfterCancel = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ content: "Não deveria enviar" });
    expect(sendAfterCancel.status).toBe(403);

    const messages = await request(app)
      .get(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(messages.status).toBe(200);
    expect(messages.body.isOpen).toBe(false);
    expect(messages.body.messages.length).toBe(1);
  });

  it("entrega mensagem em tempo real pra quem participa do contrato, não pra quem não participa", async () => {
    const contract = await makeContract("ACTIVE");

    const clientSocket = await connectClient(serverUrl, clientToken);
    const outsiderSocket = await connectClient(serverUrl, outsiderToken);
    try {
      clientSocket.emit("join:consultancy", contract.id);
      outsiderSocket.emit("join:consultancy", contract.id);
      await waitFor(150);

      const received = new Promise<{ content: string }>((resolve) => {
        clientSocket.once("message:new", resolve);
      });
      let outsiderReceivedAnything = false;
      outsiderSocket.once("message:new", () => {
        outsiderReceivedAnything = true;
      });

      const response = await request(app)
        .post(`/api/consultancy/contracts/${contract.id}/messages`)
        .set("Authorization", `Bearer ${providerToken}`)
        .send({ content: "Mensagem em tempo real" });
      expect(response.status).toBe(201);

      const message = await received;
      expect(message.content).toBe("Mensagem em tempo real");

      await waitFor(200);
      expect(outsiderReceivedAnything).toBe(false);
    } finally {
      clientSocket.disconnect();
      outsiderSocket.disconnect();
    }
  });
});
