import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { CrefValidationStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { DataRetentionService } from "../src/modules/privacy/services/data-retention.service";

// Épico de Frentes, Frente 10, Lote 5: auditoria e integridade de dados
// administrativos.
// (1) AdminAuditLog era write-only - getAuditLogs/recentModerationHistory
//     novos.
// (2) reactivateUser apagava suspensionReason sem deixar rastro - agora
//     preserva o motivo original (e o da reativação) no audit log antes
//     de limpar o campo.
// (3) cleanupSupportTickets (retenção de dados) não checava status - um
//     ticket OPEN antigo tinha o conteúdo apagado e ficava irrespondível
//     pra sempre.
// (4) listNoShowReports filtrava minStrikes em memória depois do take:200
//     - movido pro where do Prisma.

const adminService = new AdminService();
const dataRetentionService = new DataRetentionService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let adminId = "";
const createdUserIds: string[] = [];
const createdTicketIds: string[] = [];
const createdBookingIds: string[] = [];
const createdNoShowReportIds: string[] = [];
let categoryId = "";
let providerId = "";

describe("Frente 10, Lote 5 — auditoria e integridade de dados administrativos", () => {
  beforeAll(async () => {
    await prisma.$connect();

    // Épico de Frentes, Frente 1/Lote 2: ensureAdminAccess revalida
    // isAdminEmail direto no banco (defesa em profundidade) - checa o
    // e-mail contra ADMIN_ALLOWED_EMAILS, não o campo role. Mesmo padrão
    // de registro usado em todos os outros testes admin desta frente.
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Cinco Admin",
      email: adminEmail,
      password: "Test1234",
      phone: `1177${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });

    const category = await prisma.serviceCategory.create({
      data: { name: `F10L5_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Cinco Provider",
        email: uniqueEmail("f10l5_provider"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}8`,
        role: "PROVIDER"
      }
    });
    createdUserIds.push(providerUser.id);
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: "F10L5 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f10l5")}`,
        crefValidationStatus: CrefValidationStatus.APPROVED
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.noShowReport.deleteMany({ where: { id: { in: createdNoShowReportIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.supportTicket.deleteMany({ where: { id: { in: createdTicketIds } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [...createdUserIds, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("reativar preserva o motivo original da suspensão no audit log (antes de limpar o campo)", async () => {
    const target = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Cinco Reativado",
        email: uniqueEmail("f10l5_reactivated"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}7`,
        role: "CLIENT"
      }
    });
    createdUserIds.push(target.id);

    await adminService.suspendUser(adminId, target.id, "Fraude confirmada no pagamento");
    await adminService.reactivateUser(adminId, target.id, "Recurso aceito, engano identificado");

    // writeAdminAuditLog é fire-and-forget (void ...catch(...)) dentro do
    // service - precisa de uma folga pra concluir antes de consultar.
    await sleep(150);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.suspensionReason).toBeNull();

    const auditLog = await prisma.adminAuditLog.findFirst({
      where: { targetId: target.id, action: "USER_REACTIVATED" }
    });
    expect(auditLog).not.toBeNull();
    expect((auditLog!.metadata as any).previousSuspensionReason).toBe("Fraude confirmada no pagamento");
    expect((auditLog!.metadata as any).reactivationReason).toBe("Recurso aceito, engano identificado");
  });

  it("getAuditLogs filtra por targetId e getUserDetail traz o histórico recente", async () => {
    const target = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Cinco Historico",
        email: uniqueEmail("f10l5_history"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: "CLIENT"
      }
    });
    createdUserIds.push(target.id);

    await adminService.suspendUser(adminId, target.id, "Motivo de teste");
    await adminService.reactivateUser(adminId, target.id);
    await sleep(150);

    const auditLogs = await adminService.getAuditLogs(adminId, { targetId: target.id });
    expect(auditLogs.total).toBeGreaterThanOrEqual(2);
    expect(auditLogs.items.every((i) => i.targetId === target.id)).toBe(true);

    const detail = await adminService.getUserDetail(adminId, target.id);
    expect(detail.recentModerationHistory.length).toBeGreaterThanOrEqual(2);
    expect(detail.recentModerationHistory.some((h) => h.action === "USER_SUSPENDED")).toBe(true);
    expect(detail.recentModerationHistory.some((h) => h.action === "USER_REACTIVATED")).toBe(true);
  });

  it("retenção de dados não mexe em ticket OPEN, mas continua redigindo ticket ANSWERED antigo", async () => {
    const target = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Cinco Retencao",
        email: uniqueEmail("f10l5_retention"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: "CLIENT"
      }
    });
    createdUserIds.push(target.id);

    const veryOld = new Date(Date.now() - 1826 * 24 * 60 * 60 * 1000);

    const openTicket = await prisma.supportTicket.create({
      data: {
        userId: target.id,
        subject: "Ticket aberto antigo",
        message: "conteúdo original ainda precisa de resposta",
        status: "OPEN",
        createdAt: veryOld
      }
    });
    createdTicketIds.push(openTicket.id);

    const answeredTicket = await prisma.supportTicket.create({
      data: {
        userId: target.id,
        subject: "Ticket respondido antigo",
        message: "conteúdo original já resolvido",
        status: "ANSWERED",
        adminResponse: "resposta original",
        respondedAt: veryOld,
        createdAt: veryOld
      }
    });
    createdTicketIds.push(answeredTicket.id);

    await dataRetentionService.run({ now: new Date(), dryRun: false });

    const storedOpen = await prisma.supportTicket.findUniqueOrThrow({ where: { id: openTicket.id } });
    expect(storedOpen.message).toBe("conteúdo original ainda precisa de resposta");
    expect(storedOpen.status).toBe("OPEN");

    const storedAnswered = await prisma.supportTicket.findUniqueOrThrow({ where: { id: answeredTicket.id } });
    expect(storedAnswered.message).toBe("Conteudo removido por politica de retencao.");
  });

  it("listNoShowReports filtra minStrikes corretamente (via where do Prisma, não em memória)", async () => {
    const clientLowStrikes = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Cinco Low Strikes",
        email: uniqueEmail("f10l5_low"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "CLIENT",
        noShowStrikes: 1
      }
    });
    createdUserIds.push(clientLowStrikes.id);

    const clientHighStrikes = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Cinco High Strikes",
        email: uniqueEmail("f10l5_high"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT",
        noShowStrikes: 5
      }
    });
    createdUserIds.push(clientHighStrikes.id);

    const reporter = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Cinco Reporter",
        email: uniqueEmail("f10l5_reporter"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    createdUserIds.push(reporter.id);

    for (const client of [clientLowStrikes, clientHighStrikes]) {
      const booking = await prisma.booking.create({
        data: {
          clientId: client.id,
          providerId,
          categoryId,
          scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
          priceCents: 10000,
          status: "COMPLETED"
        }
      });
      createdBookingIds.push(booking.id);
      const report = await prisma.noShowReport.create({
        data: { bookingId: booking.id, reportedUserId: client.id, reportedByUserId: reporter.id }
      });
      createdNoShowReportIds.push(report.id);
    }

    const highOnly = await adminService.listNoShowReports(adminId, 5);
    const highIds = highOnly.map((r) => r.reportedUser.id);
    expect(highIds).toContain(clientHighStrikes.id);
    expect(highIds).not.toContain(clientLowStrikes.id);
  });
});
