import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";
import { DebtService } from "../src/modules/payments/services/debt.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { ModerationService } from "../src/modules/admin/services/moderation.service";
import { createManualPhotoPost, reportPost } from "../src/modules/community/services/feed.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";
import { AdminService } from "../src/modules/admin/services/admin.service";

// Frente 7 (segunda camada): operação administrativa e suporte.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER", email?: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: email ?? `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

describe("Frente 7 (segunda camada), Lote 1 — guard de admin divergente (emailVerifiedAt)", () => {
  const disputeCaseService = new DisputeCaseService();
  const debtService = new DebtService();
  const providerService = new ProviderService();

  let unverifiedAdminId = "";
  const unverifiedAdminEmail = `${uid("l1_unverified_admin")}@test.com`;

  beforeAll(async () => {
    await prisma.$connect();

    // O admin da allowlist é registrado sem verificação de e-mail (mesmo
    // fluxo real) e colocado na allowlist só pro escopo deste teste — assim
    // dá pra testar o guard "acesso negado" sem mexer na conta admin
    // compartilhada por ~35 outros arquivos de teste (que já está verificada
    // no banco e não pode ser dessverificada sem arriscar quebrar testes
    // rodando em paralelo).
    const unverifiedAdmin = await registerUser("l1_unverified_admin", "Admin Nao Verificado", undefined, unverifiedAdminEmail);
    unverifiedAdminId = unverifiedAdmin.userId;
    env.ADMIN_ALLOWED_EMAILS.push(unverifiedAdminEmail.toLowerCase());

    const admin = await prisma.user.findUniqueOrThrow({ where: { id: unverifiedAdminId } });
    expect(admin.emailVerifiedAt).toBeNull();
  });

  afterAll(async () => {
    const idx = env.ADMIN_ALLOWED_EMAILS.indexOf(unverifiedAdminEmail.toLowerCase());
    if (idx >= 0) env.ADMIN_ALLOWED_EMAILS.splice(idx, 1);
    await prisma.session.deleteMany({ where: { userId: unverifiedAdminId } });
    await prisma.user.deleteMany({ where: { id: unverifiedAdminId } });
  });

  it("DisputeCaseService nega acesso a admin da allowlist com e-mail não verificado", async () => {
    await expect(disputeCaseService.listCases(unverifiedAdminId)).rejects.toMatchObject({
      statusCode: StatusCodes.FORBIDDEN
    });
  });

  it("DebtService nega acesso a admin da allowlist com e-mail não verificado", async () => {
    await expect(debtService.listAllDebts(unverifiedAdminId)).rejects.toMatchObject({
      statusCode: StatusCodes.FORBIDDEN
    });
  });

  it("ProviderService (fila de CREF) nega acesso a admin da allowlist com e-mail não verificado", async () => {
    await expect(providerService.listCrefValidationQueue(unverifiedAdminId)).rejects.toMatchObject({
      statusCode: StatusCodes.FORBIDDEN
    });
  });
});

describe("Frente 7 (segunda camada), Lote 3 — rota órfã de aprovação de CREF removida", () => {
  it("PATCH /providers/:providerId/credentials/validate não existe mais (bypass sem rate limit da fila oficial)", async () => {
    const response = await request(app).patch(`/api/providers/${uid("fake_id")}/credentials/validate`);
    expect(response.status).toBe(404);
  });
});

describe("Frente 7 (segunda camada), Lote 4 — paginação real na lista de disputas", () => {
  const disputeCaseService = new DisputeCaseService();
  let adminId = "";
  let clientId = "";
  let providerId = "";
  let categoryId = "";
  const disputeIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: uid("L4_categoria"), description: "test" }
    });
    categoryId = category.id;

    const client = await registerUser("l4_client", "Lote Quatro Cliente");
    clientId = client.userId;

    const provider = await registerUser("l4_provider", "Lote Quatro Profissional", "PROVIDER");
    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${provider.token}`)
      .send({
        displayName: "Lote Quatro Profissional",
        bio: "Provider de teste do Lote 4",
        experienceYears: 2,
        priceCents: 8000,
        categoryIds: [categoryId]
      });
    providerId = profile.body.id;

    // Admin da allowlist é reaproveitado se outro arquivo já registrou
    // primeiro (mesmo padrão já usado em tests/dispute-cases.test.ts).
    const adminReg = await registerUser("l4_admin", "Lote Quatro Admin", undefined, env.ADMIN_ALLOWED_EMAILS[0]).catch(
      () => null
    );
    adminId = adminReg?.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;

    for (let i = 0; i < 3; i++) {
      const dc = await prisma.disputeCase.create({
        data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 1000 + i, status: "OPEN" }
      });
      disputeIds.push(dc.id);
    }
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
  });

  it("respeita skip/take e sinaliza hasMore quando há mais casos além da página", async () => {
    // Garantido pelo menos 2 casos OPEN no banco (os 3 criados acima), então
    // uma página de tamanho 1 sempre deve sinalizar hasMore.
    const page1 = await disputeCaseService.listCases(adminId, "OPEN", 0, 1);
    expect(page1.items.length).toBe(1);
    expect(page1.hasMore).toBe(true);

    const page2 = await disputeCaseService.listCases(adminId, "OPEN", 1, 1);
    expect(page2.items.length).toBe(1);
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
  });

  it("os 3 casos criados neste teste são todos alcançáveis na fila (não ficam presos atrás de outros)", async () => {
    const page = await disputeCaseService.listCases(adminId, "OPEN", 0, 200);
    const ids = page.items.map((item) => item.id);
    for (const id of disputeIds) {
      expect(ids).toContain(id);
    }
  });
});

describe("Frente 7 (segunda camada), Lote 10 — desocultar conteúdo de verdade + notificações", () => {
  const moderationService = new ModerationService();
  let adminId = "";
  let authorId = "";
  let reporterId = "";
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const author = await registerUser("l10_author", "Lote Dez Autor");
    authorId = author.userId;
    createdUserIds.push(authorId);

    const reporter = await registerUser("l10_reporter", "Lote Dez Denunciante");
    reporterId = reporter.userId;
    createdUserIds.push(reporterId);

    // reportPost exige que o denunciante siga o autor (ou seja o próprio
    // dono do post) pra conseguir ver/denunciar — mesmo requisito já
    // documentado em tests/frente10-lote1-moderation-queue.test.ts.
    await prisma.follow.create({ data: { followerId: reporterId, followingId: authorId } });

    const adminReg = await registerUser("l10_admin", "Lote Dez Admin", undefined, env.ADMIN_ALLOWED_EMAILS[0]).catch(
      () => null
    );
    adminId = adminReg?.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;
  });

  afterAll(async () => {
    await prisma.feedPostReport.deleteMany({ where: { postId: { in: createdPostIds } } });
    await prisma.feedPost.deleteMany({ where: { id: { in: createdPostIds } } });
    await prisma.follow.deleteMany({ where: { followerId: reporterId, followingId: authorId } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("desocultar um post reverte hiddenByAdminAt/hiddenByAdminId de verdade (rota antes não existia)", async () => {
    await createManualPhotoPost(authorId, "https://fake-bucket.r2.dev/feed-photos/l10-unhide.jpg", "post pra desocultar");
    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId: authorId, caption: "post pra desocultar" },
      orderBy: { createdAt: "desc" }
    });
    createdPostIds.push(post.id);
    await reportPost(post.id, reporterId, "abuso");
    const report = await prisma.feedPostReport.findUniqueOrThrow({
      where: { postId_reporterId: { postId: post.id, reporterId } }
    });

    await moderationService.hideReportedContent(adminId, "feed-post", report.id);
    const hidden = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(hidden.hiddenByAdminAt).not.toBeNull();

    await moderationService.unhideContent(adminId, "feed-post", report.id);
    const restored = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(restored.hiddenByAdminAt).toBeNull();
    expect(restored.hiddenByAdminId).toBeNull();
  });

  it("desocultar um conteúdo que não está oculto é rejeitado", async () => {
    await createManualPhotoPost(authorId, "https://fake-bucket.r2.dev/feed-photos/l10-not-hidden.jpg", "post nunca oculto");
    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId: authorId, caption: "post nunca oculto" },
      orderBy: { createdAt: "desc" }
    });
    createdPostIds.push(post.id);
    await reportPost(post.id, reporterId, "denúncia sem procedência");
    const report = await prisma.feedPostReport.findUniqueOrThrow({
      where: { postId_reporterId: { postId: post.id, reporterId } }
    });
    await moderationService.dismissReport(adminId, "feed-post", report.id);

    await expect(moderationService.unhideContent(adminId, "feed-post", report.id)).rejects.toThrow(
      /não está oculto/i
    );
  });
});

describe("Frente 7 (segunda camada), Lote 11 — baixa de dívida com trava atômica + notificação", () => {
  const debtService = new DebtService();
  let adminId = "";
  let clientId = "";
  let providerId = "";
  let categoryId = "";
  const disputeCaseIds: string[] = [];
  const debtIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: uid("L11_categoria"), description: "test" } });
    categoryId = category.id;

    const client = await registerUser("l11_client", "Lote Onze Cliente");
    clientId = client.userId;

    const provider = await registerUser("l11_provider", "Lote Onze Profissional", "PROVIDER");
    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${provider.token}`)
      .send({
        displayName: "Lote Onze Profissional",
        bio: "Provider de teste do Lote 11",
        experienceYears: 2,
        priceCents: 8000,
        categoryIds: [categoryId]
      });
    providerId = profile.body.id;

    const adminReg = await registerUser("l11_admin", "Lote Onze Admin", undefined, env.ADMIN_ALLOWED_EMAILS[0]).catch(
      () => null
    );
    adminId = adminReg?.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;
  });

  afterAll(async () => {
    await prisma.debtRecord.deleteMany({ where: { id: { in: debtIds } } });
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeCaseIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
  });

  it("dar baixa em dívida notifica o devedor e, sob corrida (duplo toque), só uma chamada vence", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    disputeCaseIds.push(disputeCase.id);

    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 5000,
        reason: "teste lote 11",
        status: "NOTIFIED"
      }
    });
    debtIds.push(debt.id);

    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    const [first, second] = await Promise.allSettled([
      debtService.writeOffDebt(adminId, debt.id, "Duplo toque simultâneo — primeira chamada."),
      debtService.writeOffDebt(adminId, debt.id, "Duplo toque simultâneo — segunda chamada.")
    ]);
    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const stored = await prisma.debtRecord.findUniqueOrThrow({ where: { id: debt.id } });
    expect(stored.status).toBe("WRITTEN_OFF");

    expect(notifySpy).toHaveBeenCalledWith(
      [clientId],
      expect.objectContaining({ data: expect.objectContaining({ type: "DEBT_WRITTEN_OFF" }) })
    );

    notifySpy.mockRestore();
  });
});

describe("Frente 7 (segunda camada), Lote 12 — e-mail mascarado no log de auditoria de chat", () => {
  const adminService = new AdminService();
  let adminId = "";
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  const clientEmail = `${uid("l12_client")}@exemplo.com`;
  const providerEmail = `${uid("l12_provider")}@exemplo.com`;

  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: uid("L12_categoria"), description: "test" } });
    categoryId = category.id;

    const client = await registerUser("l12_client", "Lote Doze Cliente", undefined, clientEmail);
    clientId = client.userId;

    const provider = await registerUser("l12_provider", "Lote Doze Profissional", "PROVIDER", providerEmail);
    providerUserId = provider.userId;
    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${provider.token}`)
      .send({
        displayName: "Lote Doze Profissional",
        bio: "Provider de teste do Lote 12",
        experienceYears: 2,
        priceCents: 8000,
        categoryIds: [categoryId]
      });
    providerId = profile.body.id;

    const adminReg = await registerUser("l12_admin", "Lote Doze Admin", undefined, env.ADMIN_ALLOWED_EMAILS[0]).catch(
      () => null
    );
    adminId = adminReg?.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;
  });

  afterAll(async () => {
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
  });

  it("listChatAuditSessions mascara clientEmail/providerEmail no log ADMIN_CHAT_AUDIT_LIST", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await adminService.listChatAuditSessions(adminId, { clientEmail, providerEmail });
    const logged = infoSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    infoSpy.mockRestore();

    expect(logged).toContain("ADMIN_CHAT_AUDIT_LIST");
    expect(logged).not.toContain(clientEmail);
    expect(logged).not.toContain(providerEmail);
    const [clientLocal] = clientEmail.split("@");
    const [providerLocal] = providerEmail.split("@");
    expect(logged).toContain(`${clientLocal.slice(0, 2)}${"*".repeat(clientLocal.length - 2)}@exemplo.com`);
    expect(logged).toContain(`${providerLocal.slice(0, 2)}${"*".repeat(providerLocal.length - 2)}@exemplo.com`);
  });
});
