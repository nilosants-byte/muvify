import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { DataRetentionService } from "../src/modules/privacy/services/data-retention.service";

// Fase 6 (disputas) adicionou DisputeCase/NoShowReport.reportReason/contestReason
// como texto livre nunca coberto pelo job automatico de retencao/expurgo — este
// teste cobre as duas regras novas (dispute_case_narratives_redaction e
// no_show_report_narratives_redaction), sem tocar nas 15 regras pre-existentes
// do servico (que ja nao tinham cobertura de teste antes desta mudanca).

const dataRetentionService = new DataRetentionService();
const RETENTION_DAYS = 730;
const OLD_DATE = new Date(Date.now() - (RETENTION_DAYS + 5) * 24 * 60 * 60 * 1000);
const RECENT_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("DataRetentionService — expurgo de texto livre de disputas", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `DR_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "DR Client",
        email: `${uid("dr_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "DR Provider",
        email: `${uid("dr_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "DR Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.noShowReport.deleteMany({ where: { reportedByUserId: clientId } });
    await prisma.booking.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeBooking() {
    return prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 8000,
        status: BookingStatus.CANCELLED
      }
    });
  }

  it("redige o motivo de um relato de falta RESOLVED antigo, mas mantém um recente intocado", async () => {
    const oldBooking = await makeBooking();
    const oldReport = await prisma.noShowReport.create({
      data: {
        bookingId: oldBooking.id,
        reportedUserId: providerUserId,
        reportedByUserId: clientId,
        status: "RESOLVED",
        reportReason: "Motivo antigo — deve ser removido",
        contestReason: "Contestação antiga — deve ser removida",
        contestDeadlineAt: OLD_DATE,
        resolvedAt: OLD_DATE
      }
    });

    const recentBooking = await makeBooking();
    const recentReport = await prisma.noShowReport.create({
      data: {
        bookingId: recentBooking.id,
        reportedUserId: providerUserId,
        reportedByUserId: clientId,
        status: "RESOLVED",
        reportReason: "Motivo recente — deve continuar",
        contestReason: "Contestação recente — deve continuar",
        contestDeadlineAt: RECENT_DATE,
        resolvedAt: RECENT_DATE
      }
    });

    await dataRetentionService.run({ dryRun: false, triggeredBy: "test" });

    const oldAfter = await prisma.noShowReport.findUnique({ where: { id: oldReport.id } });
    expect(oldAfter?.reportReason).toBeNull();
    expect(oldAfter?.contestReason).toBeNull();

    const recentAfter = await prisma.noShowReport.findUnique({ where: { id: recentReport.id } });
    expect(recentAfter?.reportReason).toBe("Motivo recente — deve continuar");
    expect(recentAfter?.contestReason).toBe("Contestação recente — deve continuar");
  });

  it("redige contextNote/resolutionNote de um DisputeCase RESOLVED antigo, mas nunca mexe num caso OPEN", async () => {
    const resolvedOldCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        clientId,
        providerId,
        amountCents: 5000,
        status: "RESOLVED",
        resolution: "DENIED",
        contextNote: "Nota de contexto antiga",
        resolutionNote: "Motivo antigo do admin",
        resolvedAt: OLD_DATE
      }
    });

    const openCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        clientId,
        providerId,
        amountCents: 5000,
        status: "OPEN",
        contextNote: "Caso aberto — nunca deve ser mexido"
      }
    });

    await dataRetentionService.run({ dryRun: false, triggeredBy: "test" });

    const resolvedAfter = await prisma.disputeCase.findUnique({ where: { id: resolvedOldCase.id } });
    expect(resolvedAfter?.contextNote).toBeNull();
    expect(resolvedAfter?.resolutionNote).toBe("[CONTEUDO REMOVIDO POR RETENCAO]");

    const openAfter = await prisma.disputeCase.findUnique({ where: { id: openCase.id } });
    expect(openAfter?.contextNote).toBe("Caso aberto — nunca deve ser mexido");
  });

  it("respeita legal hold: não redige relato/caso de um usuário em bloqueio", async () => {
    const booking = await makeBooking();
    const report = await prisma.noShowReport.create({
      data: {
        bookingId: booking.id,
        reportedUserId: providerUserId,
        reportedByUserId: clientId,
        status: "RESOLVED",
        reportReason: "Sob legal hold — não pode sumir",
        contestDeadlineAt: OLD_DATE,
        resolvedAt: OLD_DATE
      }
    });

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "NO_SHOW_CONTESTED",
        clientId,
        providerId,
        amountCents: 5000,
        status: "RESOLVED",
        resolution: "DENIED",
        resolutionNote: "Sob legal hold — não pode sumir",
        resolvedAt: OLD_DATE
      }
    });

    await dataRetentionService.run({ dryRun: false, triggeredBy: "test", legalHoldUserIds: [clientId] });

    const reportAfter = await prisma.noShowReport.findUnique({ where: { id: report.id } });
    expect(reportAfter?.reportReason).toBe("Sob legal hold — não pode sumir");

    const caseAfter = await prisma.disputeCase.findUnique({ where: { id: disputeCase.id } });
    expect(caseAfter?.resolutionNote).toBe("Sob legal hold — não pode sumir");
  });
});
