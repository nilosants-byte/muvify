import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { CrefValidationStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ModerationService } from "../src/modules/admin/services/moderation.service";
import { createManualPhotoPost, reportPost, getFeed } from "../src/modules/community/services/feed.service";

// Épico de Frentes, Frente 10, Lote 1: moderação de denúncias não existia -
// FeedPostReport (Frente 8/Lote 2) e BookingMessageReport/
// ConsultancyMessageReport (Frente 9/Lote 10) só persistiam o registro, sem
// nenhum endpoint/tela que os lesse. Cobre a fila unificada, descartar
// (sem efeito no conteúdo) e ocultar (some pra todo mundo, marca a
// denúncia ACTIONED, nunca apaga de vez).

const moderationService = new ModerationService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

let adminId = "";
let adminToken = "";
let categoryId = "";

let authorId = "";
let followerId = "";
let viewerId = "";

let providerUserId = "";
let providerId = "";
let clientId = "";
let clientToken = "";
let bookingId = "";
let contractId = "";

const createdUserIds: string[] = [];
const createdPostIds: string[] = [];
const createdBookingIds: string[] = [];
const createdRequestIds: string[] = [];
const createdContractIds: string[] = [];

describe("Frente 10, Lote 1 — moderação de denúncias", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F10L1_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    // Admin
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Um Admin",
      email: adminEmail,
      password: PASSWORD,
      phone: `1177${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
    const adminLogin = await request(app).post("/api/auth/login").send({ email: adminEmail, password: PASSWORD });
    adminToken = adminLogin.body.accessToken;

    // Feed: autor + seguidor que vai denunciar + terceiro viewer que também segue
    const author = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Um Autor",
        email: uniqueEmail("f10l1_author"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    authorId = author.id;
    createdUserIds.push(authorId);

    const follower = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Um Seguidor",
        email: uniqueEmail("f10l1_follower"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "CLIENT"
      }
    });
    followerId = follower.id;
    createdUserIds.push(followerId);

    const viewer = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Um Viewer",
        email: uniqueEmail("f10l1_viewer"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT"
      }
    });
    viewerId = viewer.id;
    createdUserIds.push(viewerId);

    await prisma.follow.createMany({
      data: [
        { followerId, followingId: authorId },
        { followerId: viewerId, followingId: authorId }
      ]
    });

    // Booking chat: provider + client + booking
    const providerUser = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Um Provider",
        email: uniqueEmail("f10l1_provider"),
        password: PASSWORD,
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    createdUserIds.push(providerUserId);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "F10L1 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f10l1")}`,
        crefValidationStatus: CrefValidationStatus.APPROVED
      }
    });
    providerId = provider.id;

    const clientRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Um Client",
      email: uniqueEmail("f10l1_client"),
      password: PASSWORD,
      phone: `1188${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    clientToken = clientRegister.body.accessToken;
    clientId = clientRegister.body.user.id;
    await prisma.user.update({ where: { id: clientId }, data: { emailVerifiedAt: new Date() } });
    createdUserIds.push(clientId);

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priceCents: 10000
      }
    });
    bookingId = booking.id;
    createdBookingIds.push(bookingId);

    // Consultoria: request + contrato ACTIVE
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });

    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    createdRequestIds.push(consultancyRequest.id);

    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: consultancyRequest.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractId = contract.id;
    createdContractIds.push(contractId);
  });

  afterAll(async () => {
    await prisma.feedPostReport.deleteMany({ where: { postId: { in: createdPostIds } } });
    await prisma.feedPost.deleteMany({ where: { id: { in: createdPostIds } } });
    await prisma.follow.deleteMany({ where: { followerId: { in: [followerId, viewerId] } } });
    await prisma.consultancyMessage.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { providerId } });
    await prisma.bookingMessage.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [...createdUserIds, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("fila unificada lista denúncias pendentes dos 3 tipos", async () => {
    await createManualPhotoPost(authorId, "https://fake-bucket.r2.dev/feed-photos/f10l1.jpg", "post pra denunciar");
    const post = await prisma.feedPost.findFirstOrThrow({ where: { userId: authorId }, orderBy: { createdAt: "desc" } });
    createdPostIds.push(post.id);
    await reportPost(post.id, followerId, "conteúdo ofensivo");

    const bookingMessage = await prisma.bookingMessage.create({
      data: { bookingId, senderId: clientId, content: "mensagem pra denunciar" }
    });
    await prisma.bookingMessageReport.create({
      data: { messageId: bookingMessage.id, reporterId: providerUserId, reason: "spam" }
    });

    const consultancyMessage = await prisma.consultancyMessage.create({
      data: { contractId, senderId: clientId, content: "mensagem consultoria pra denunciar" }
    });
    await prisma.consultancyMessageReport.create({
      data: { messageId: consultancyMessage.id, reporterId: providerUserId, reason: "spam" }
    });

    const { items } = await moderationService.listReports(adminId, { status: "PENDING", take: 100 });
    const types = items.map((i) => i.type);
    expect(types).toContain("feed-post");
    expect(types).toContain("booking-message");
    expect(types).toContain("consultancy-message");
  });

  it("ocultar o post denunciado some do feed pra todo mundo, não só pra quem denunciou, e marca a denúncia ACTIONED", async () => {
    await createManualPhotoPost(authorId, "https://fake-bucket.r2.dev/feed-photos/f10l1-hide.jpg", "post pra ocultar");
    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId: authorId, caption: "post pra ocultar" },
      orderBy: { createdAt: "desc" }
    });
    createdPostIds.push(post.id);
    await reportPost(post.id, followerId, "abuso");

    const report = await prisma.feedPostReport.findUniqueOrThrow({
      where: { postId_reporterId: { postId: post.id, reporterId: followerId } }
    });

    await moderationService.hideReportedContent(adminId, "feed-post", report.id);

    const stored = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(stored.hiddenByAdminAt).not.toBeNull();
    expect(stored.hiddenByAdminId).toBe(adminId);

    const storedReport = await prisma.feedPostReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(storedReport.status).toBe("ACTIONED");

    // Some pra um terceiro viewer que segue o autor - não só pra quem denunciou
    const feed = await getFeed(viewerId, 1, 50);
    expect(feed.items.some((item) => item.id === post.id)).toBe(false);
  });

  it("ocultar mensagem de chat de agendamento some do chat pra todo mundo", async () => {
    const message = await prisma.bookingMessage.create({
      data: { bookingId, senderId: clientId, content: "mensagem de chat pra ocultar" }
    });
    await prisma.bookingMessageReport.create({
      data: { messageId: message.id, reporterId: providerUserId, reason: "abuso" }
    });
    const report = await prisma.bookingMessageReport.findUniqueOrThrow({
      where: { messageId_reporterId: { messageId: message.id, reporterId: providerUserId } }
    });

    await moderationService.hideReportedContent(adminId, "booking-message", report.id);

    const stored = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.hiddenByAdminAt).not.toBeNull();

    const response = await request(app)
      .get(`/api/bookings/${bookingId}/messages`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(response.status).toBe(200);
    expect(response.body.messages.some((m: { id: string }) => m.id === message.id)).toBe(false);
  });

  it("ocultar mensagem de chat de consultoria some do chat pra todo mundo", async () => {
    const message = await prisma.consultancyMessage.create({
      data: { contractId, senderId: clientId, content: "mensagem consultoria pra ocultar" }
    });
    await prisma.consultancyMessageReport.create({
      data: { messageId: message.id, reporterId: providerUserId, reason: "abuso" }
    });
    const report = await prisma.consultancyMessageReport.findUniqueOrThrow({
      where: { messageId_reporterId: { messageId: message.id, reporterId: providerUserId } }
    });

    await moderationService.hideReportedContent(adminId, "consultancy-message", report.id);

    const stored = await prisma.consultancyMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.hiddenByAdminAt).not.toBeNull();

    const response = await request(app)
      .get(`/api/consultancy/contracts/${contractId}/messages`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(response.status).toBe(200);
    expect(response.body.messages.some((m: { id: string }) => m.id === message.id)).toBe(false);
  });

  it("descartar denúncia marca DISMISSED sem esconder o conteúdo", async () => {
    await createManualPhotoPost(authorId, "https://fake-bucket.r2.dev/feed-photos/f10l1-dismiss.jpg", "post pra descartar");
    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId: authorId, caption: "post pra descartar" },
      orderBy: { createdAt: "desc" }
    });
    createdPostIds.push(post.id);
    await reportPost(post.id, followerId, "denúncia sem procedência");
    const report = await prisma.feedPostReport.findUniqueOrThrow({
      where: { postId_reporterId: { postId: post.id, reporterId: followerId } }
    });

    await moderationService.dismissReport(adminId, "feed-post", report.id);

    const storedReport = await prisma.feedPostReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(storedReport.status).toBe("DISMISSED");
    expect(storedReport.reviewedById).toBe(adminId);

    const storedPost = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(storedPost.hiddenByAdminAt).toBeNull();
  });

  it("conteúdo já oculto não some de novo (dismiss/hide num relatório já revisado retorna 404)", async () => {
    await createManualPhotoPost(authorId, "https://fake-bucket.r2.dev/feed-photos/f10l1-double.jpg", "post duplo");
    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId: authorId, caption: "post duplo" },
      orderBy: { createdAt: "desc" }
    });
    createdPostIds.push(post.id);
    await reportPost(post.id, followerId, "abuso");
    const report = await prisma.feedPostReport.findUniqueOrThrow({
      where: { postId_reporterId: { postId: post.id, reporterId: followerId } }
    });

    await moderationService.hideReportedContent(adminId, "feed-post", report.id);
    await expect(moderationService.dismissReport(adminId, "feed-post", report.id)).rejects.toThrow();
  });
});
