import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Épico de Frentes, Frente 1 (Autorização/IDOR), Lote 2:
// (1) defesa em profundidade nos métodos do admin service que dependiam só
//     do middleware de rota.
// (2) 404 em vez de 403 quando um bookingId existe mas não é do usuário.
// (3) imageUrl/mediaUrl restritos ao próprio storage (exceto YouTube pra
//     exercício).
// (4) editar/apagar comentário cruza commentId com o postId da rota.
// (5) getStudentAnamnesis aceita vínculo por consultoria, não só booking.

const adminService = new AdminService();
const providerService = new ProviderService();
const bookingService = new BookingService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("Frente 1, Lote 2 — defesa em profundidade no admin service", () => {
  let nonAdminId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        name: "Nao Admin",
        email: `${uid("naoadmin")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    nonAdminId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: nonAdminId } });
    await prisma.$disconnect();
  });

  it("getDashboardOverview rejeita quem não é admin", async () => {
    await expect(adminService.getDashboardOverview(nonAdminId, {})).rejects.toThrow(/acesso negado/i);
  });

  it("listSupportTickets rejeita quem não é admin", async () => {
    await expect(adminService.listSupportTickets(nonAdminId, {})).rejects.toThrow(/acesso negado/i);
  });

  it("lookupCrefByDocument rejeita quem não é admin", async () => {
    await expect(adminService.lookupCrefByDocument(nonAdminId, "12345678900")).rejects.toThrow(/acesso negado/i);
  });

  it("lookupChatsByDocuments rejeita quem não é admin", async () => {
    await expect(
      adminService.lookupChatsByDocuments(nonAdminId, "12345678900", "98765432100")
    ).rejects.toThrow(/acesso negado/i);
  });

  it("lookupBookingsByDocuments rejeita quem não é admin", async () => {
    await expect(
      adminService.lookupBookingsByDocuments(nonAdminId, "12345678900", "98765432100")
    ).rejects.toThrow(/acesso negado/i);
  });

  it("lookupBookingDetail rejeita quem não é admin", async () => {
    await expect(
      adminService.lookupBookingDetail(nonAdminId, "00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(/acesso negado/i);
  });

  it("listNoShowReports rejeita quem não é admin", async () => {
    await expect(adminService.listNoShowReports(nonAdminId)).rejects.toThrow(/acesso negado/i);
  });

  it("listCrefValidationQueue rejeita quem não é admin", async () => {
    await expect(providerService.listCrefValidationQueue(nonAdminId)).rejects.toThrow(/acesso negado/i);
  });
});

describe("Frente 1, Lote 2 — 404 em vez de 403 pra bookingId de outro usuário", () => {
  let clientId = "";
  let outsiderId = "";
  let outsiderToken = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let bookingId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `R5F1L2_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Lote2 Client",
        email: `${uid("l2_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Lote2 Provider",
        email: `${uid("l2_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote2 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: "PENDING"
      }
    });
    bookingId = booking.id;

    const outsiderReg = await request(app).post("/api/auth/register").send({
      name: "Outsider Lote Dois",
      email: `${uid("l2_outsider")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}3`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    outsiderToken = outsiderReg.body.accessToken;
    outsiderId = outsiderReg.body.user.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId, outsiderId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, outsiderId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("getAttendanceCode: outsider recebe 404, não 403", async () => {
    await expect(bookingService.getAttendanceCode(outsiderId, bookingId)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("reportNoShow: outsider recebe 404, não 403", async () => {
    await expect(bookingService.reportNoShow(outsiderId, bookingId)).rejects.toMatchObject({
      statusCode: 404
    });
  });
});

describe("Frente 1, Lote 2 — imageUrl/mediaUrl restritos ao próprio storage", () => {
  let token = "";
  let userId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const reg = await request(app).post("/api/auth/register").send({
      name: "Lote Dois Media",
      email: `${uid("l2_media")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}4`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("rejeita post de feed com imageUrl de domínio externo", async () => {
    const res = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ imageUrl: "https://evil.example.com/tracker.jpg" });
    expect(res.status).toBe(400);
  });

  it("aceita post de feed com imageUrl do próprio bucket", async () => {
    const res = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ imageUrl: `${env.R2_PUBLIC_URL}/feed-photos/abc.jpg` });
    expect(res.status).toBe(201);
  });
});

describe("Frente 1, Lote 2 — comentário cruza postId com commentId", () => {
  let tokenA = "";
  let userAId = "";
  let postAId = "";
  let postBId = "";
  let commentId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const regA = await request(app).post("/api/auth/register").send({
      name: "Comment Cross A",
      email: `${uid("cc_a")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    await request(app).post("/api/community/feed/posts").set("Authorization", `Bearer ${tokenA}`).send({ caption: "Post 1" });
    const post1 = await prisma.feedPost.findFirst({ where: { userId: userAId }, orderBy: { createdAt: "desc" } });
    postAId = post1!.id;

    await request(app).post("/api/community/feed/posts").set("Authorization", `Bearer ${tokenA}`).send({ caption: "Post 2" });
    const post2 = await prisma.feedPost.findFirst({
      where: { userId: userAId, id: { not: postAId } },
      orderBy: { createdAt: "desc" }
    });
    postBId = post2!.id;

    const commentRes = await request(app)
      .post(`/api/community/feed/posts/${postAId}/comments`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ content: "comentário no post A" });
    commentId = commentRes.body.id;
  });

  afterAll(async () => {
    await prisma.feedPostComment.deleteMany({ where: { postId: { in: [postAId, postBId] } } });
    await prisma.feedPost.deleteMany({ where: { id: { in: [postAId, postBId] } } });
    await prisma.session.deleteMany({ where: { userId: userAId } });
    await prisma.user.deleteMany({ where: { id: userAId } });
    await prisma.$disconnect();
  });

  it("rejeita editar o comentário usando o postId errado (comentário é do post A, não do B)", async () => {
    const res = await request(app)
      .patch(`/api/community/feed/posts/${postBId}/comments/${commentId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ content: "tentando editar com postId errado" });
    expect(res.status).toBe(404);
  });

  it("edita normalmente com o postId certo", async () => {
    const res = await request(app)
      .patch(`/api/community/feed/posts/${postAId}/comments/${commentId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ content: "editado com postId certo" });
    expect(res.status).toBe(200);
  });
});

describe("Frente 1, Lote 2 — getStudentAnamnesis aceita vínculo por consultoria", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";
  let contractId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `R5F1L2B_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Anamnesis Client",
        email: `${uid("anam_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Anamnesis Provider",
        email: `${uid("anam_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Anamnesis Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: "Consultoria anamnese", billingCycle: "MONTHLY", priceCents: 20000 }
    });
    offerId = offer.id;
    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: consultancyRequest.id,
        providerId,
        clientId,
        offerId,
        status: "ACTIVE",
        paymentMethod: "PIX",
        paymentInstallments: 1,
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
    contractId = contract.id;
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { id: contractId } });
    await prisma.consultancyRequest.deleteMany({ where: { providerId, clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("profissional vinculado só por contrato de consultoria (sem nenhum booking) consegue ver a anamnese do aluno", async () => {
    const result = await providerService.getStudentAnamnesis(providerUserId, clientId);
    expect(result.status).toBe("COMPLETED");
  });
});
