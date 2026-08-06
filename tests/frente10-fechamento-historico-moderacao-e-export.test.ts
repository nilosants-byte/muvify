import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { ModerationService } from "../src/modules/admin/services/moderation.service";

// Épico de Frentes, Frente 10 (fechamento pós-verificação): o "histórico de
// moderação" no detalhe do usuário (getUserDetail::recentModerationHistory)
// filtrava AdminAuditLog só por targetId: userId - mas REPORT_CONTENT_HIDDEN
// grava targetId = ID do post/mensagem, nunca do autor. Resultado: ocultar
// um post por denúncia procedente nunca aparecia no histórico do autor.
// Corrigido gravando authorId em metadata na hora de ocultar, e ampliando a
// consulta pra também casar por esse metadata.

const adminService = new AdminService();
const moderationService = new ModerationService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let adminId = "";
let authorId = "";
let reporterId = "";
let postId = "";

describe("Frente 10 (fechamento) — histórico de moderação mostra ocultação de conteúdo do autor", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await request(app).post("/api/auth/register").send({
      name: "Fechamento F10 Admin",
      email: adminEmail,
      password: PASSWORD,
      phone: `1177${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });

    const author = await prisma.user.create({
      data: {
        name: "Fechamento F10 Autor",
        email: `${uid("f10fx_author")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    authorId = author.id;

    const reporter = await prisma.user.create({
      data: {
        name: "Fechamento F10 Reporter",
        email: `${uid("f10fx_reporter")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "CLIENT"
      }
    });
    reporterId = reporter.id;

    const post = await prisma.feedPost.create({
      data: { userId: authorId, type: "MANUAL_PHOTO", caption: "Post que vai ser denunciado", isAutomatic: false }
    });
    postId = post.id;
    await prisma.feedPostReport.create({ data: { postId, reporterId, reason: "Conteúdo impróprio" } });
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.feedPost.deleteMany({ where: { userId: authorId } });
    await prisma.user.deleteMany({ where: { id: { in: [authorId, reporterId] } } });
    await prisma.$disconnect();
  });

  it("ocultar post grava o autor em metadata, e o histórico de moderação do autor passa a mostrar a ação", async () => {
    const report = await prisma.feedPostReport.findFirstOrThrow({ where: { postId, reporterId } });

    const before = await adminService.getUserDetail(adminId, authorId);
    expect(before.recentModerationHistory.some((h) => h.action === "REPORT_CONTENT_HIDDEN")).toBe(false);

    await moderationService.hideReportedContent(adminId, "feed-post", report.id);

    const auditEntry = await prisma.adminAuditLog.findFirst({
      where: { action: "REPORT_CONTENT_HIDDEN", targetId: postId }
    });
    expect(auditEntry).not.toBeNull();
    expect((auditEntry!.metadata as { authorId?: string } | null)?.authorId).toBe(authorId);

    const after = await adminService.getUserDetail(adminId, authorId);
    const hiddenEntry = after.recentModerationHistory.find((h) => h.action === "REPORT_CONTENT_HIDDEN");
    expect(hiddenEntry).toBeTruthy();
  });
});
