import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { BookingStatus, CrefValidationStatus, UserRole } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Épico de Frentes, Frente 9, Lote 10: denúncia de mensagem no chat -
// espelha o padrão do FeedPostReport (Frente 8, Lote 2), agora estendido
// pros dois chats (agendamento e consultoria, Lotes 7-9).

const password = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
}

let categoryId = "";
const createdUserIds: string[] = [];
const createdProviderProfileIds: string[] = [];
const createdBookingIds: string[] = [];
const createdOfferIds: string[] = [];
const createdContractIds: string[] = [];

async function createClientAndProvider(prefix: string) {
  const phoneBase = Date.now().toString().slice(-7) + Math.floor(Math.random() * 10);

  const clientRegister = await request(app).post("/api/auth/register").send({
    name: `Frente Nove Lote Dez ${prefix} Client`,
    email: uniqueEmail(`f9l10_${prefix}_client`),
    password,
    phone: `11${phoneBase}1`,
    termsVersion: "2026.05",
    consentAccepted: true
  });
  const clientToken = clientRegister.body.accessToken as string;
  const clientId = clientRegister.body.user.id as string;
  await prisma.user.update({ where: { id: clientId }, data: { emailVerifiedAt: new Date() } });

  const providerRegister = await request(app).post("/api/auth/register").send({
    name: `Frente Nove Lote Dez ${prefix} Provider`,
    email: uniqueEmail(`f9l10_${prefix}_provider`),
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
      displayName: `F9L10 ${prefix} Provider`,
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

  createdUserIds.push(clientId, providerUserId);
  createdProviderProfileIds.push(providerProfileId);

  return { clientToken, clientId, providerToken, providerUserId, providerProfileId };
}

async function createOutsider(prefix: string) {
  const outsiderRegister = await request(app).post("/api/auth/register").send({
    name: `Frente Nove Lote Dez ${prefix} Outsider`,
    email: uniqueEmail(`f9l10_${prefix}_outsider`),
    password,
    phone: `11${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 10)}9`,
    termsVersion: "2026.05",
    consentAccepted: true
  });
  const outsiderToken = outsiderRegister.body.accessToken as string;
  const outsiderId = outsiderRegister.body.user.id as string;
  createdUserIds.push(outsiderId);
  return { outsiderToken, outsiderId };
}

describe("Frente 9, Lote 10 — denúncia de mensagem no chat", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({
      data: { name: `F9L10_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.consultancyMessage.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { providerId: { in: createdProviderProfileIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: createdOfferIds } } });
    await prisma.bookingMessage.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: createdProviderProfileIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("denunciar uma mensagem de chat de agendamento persiste o registro, sem duplicar em denúncia repetida", async () => {
    const fixture = await createClientAndProvider("booking");
    const booking = await prisma.booking.create({
      data: {
        clientId: fixture.clientId,
        providerId: fixture.providerProfileId,
        categoryId,
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    createdBookingIds.push(booking.id);

    const sendResponse = await request(app)
      .post(`/api/bookings/${booking.id}/messages`)
      .set("Authorization", `Bearer ${fixture.providerToken}`)
      .send({ content: "Mensagem abusiva de teste" });
    expect(sendResponse.status).toBe(201);
    const messageId = sendResponse.body.id as string;

    const reportOnce = await request(app)
      .post(`/api/bookings/${booking.id}/messages/${messageId}/report`)
      .set("Authorization", `Bearer ${fixture.clientToken}`)
      .send({ reason: "Conteúdo ofensivo" });
    expect(reportOnce.status).toBe(204);

    const reportTwice = await request(app)
      .post(`/api/bookings/${booking.id}/messages/${messageId}/report`)
      .set("Authorization", `Bearer ${fixture.clientToken}`)
      .send({ reason: "Conteúdo ofensivo de novo" });
    expect(reportTwice.status).toBe(204);

    const reportCount = await prisma.bookingMessageReport.count({ where: { messageId } });
    expect(reportCount).toBe(1);

    const reportRow = await prisma.bookingMessageReport.findFirst({ where: { messageId } });
    expect(reportRow?.reporterId).toBe(fixture.clientId);
    expect(reportRow?.reason).toBe("Conteúdo ofensivo");
  });

  it("não permite denunciar a própria mensagem nem mensagem de terceiro sem acesso ao agendamento", async () => {
    const fixture = await createClientAndProvider("booking-guard");
    const { outsiderToken } = await createOutsider("booking-guard");
    const booking = await prisma.booking.create({
      data: {
        clientId: fixture.clientId,
        providerId: fixture.providerProfileId,
        categoryId,
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    createdBookingIds.push(booking.id);

    const sendResponse = await request(app)
      .post(`/api/bookings/${booking.id}/messages`)
      .set("Authorization", `Bearer ${fixture.clientToken}`)
      .send({ content: "Minha própria mensagem" });
    const messageId = sendResponse.body.id as string;

    const reportOwnMessage = await request(app)
      .post(`/api/bookings/${booking.id}/messages/${messageId}/report`)
      .set("Authorization", `Bearer ${fixture.clientToken}`)
      .send({});
    expect(reportOwnMessage.status).toBe(400);

    const reportAsOutsider = await request(app)
      .post(`/api/bookings/${booking.id}/messages/${messageId}/report`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({});
    expect(reportAsOutsider.status).toBe(403);
  });

  it("denunciar uma mensagem de chat de consultoria persiste o registro, sem duplicar em denúncia repetida", async () => {
    const fixture = await createClientAndProvider("consultancy");

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: fixture.providerProfileId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria F9L10",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    createdOfferIds.push(offer.id);

    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId: fixture.providerProfileId,
        clientId: fixture.clientId,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: consultancyRequest.id,
        providerId: fixture.providerProfileId,
        clientId: fixture.clientId,
        offerId: offer.id,
        status: "ACTIVE",
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
    createdContractIds.push(contract.id);

    const sendResponse = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages`)
      .set("Authorization", `Bearer ${fixture.providerToken}`)
      .send({ content: "Mensagem abusiva de consultoria" });
    expect(sendResponse.status).toBe(201);
    const messageId = sendResponse.body.id as string;

    const reportOnce = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages/${messageId}/report`)
      .set("Authorization", `Bearer ${fixture.clientToken}`)
      .send({ reason: "Conteúdo ofensivo" });
    expect(reportOnce.status).toBe(204);

    const reportTwice = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/messages/${messageId}/report`)
      .set("Authorization", `Bearer ${fixture.clientToken}`)
      .send({ reason: "de novo" });
    expect(reportTwice.status).toBe(204);

    const reportCount = await prisma.consultancyMessageReport.count({ where: { messageId } });
    expect(reportCount).toBe(1);
  });
});
