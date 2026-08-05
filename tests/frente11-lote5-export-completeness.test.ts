import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Épico de Frentes, Frente 11, Lote 5: exportMyData cobria só um
// subconjunto pequeno de tabelas (bookings, reviews, anamnese, contratos de
// consultoria...) - faltavam SupportTicket, DisputeCase, NoShowReport,
// DebtRecord, ProviderStudentAssessment (dado de saúde!), Session,
// followers, e TODO o lado profissional. Listas longas (take:200/500)
// eram cortadas silenciosamente, sem o titular nunca saber.

const userService = new UserService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("Frente 11, Lote 5 — exportMyData cobre categorias antes ausentes (lado cliente)", () => {
  let clientId = "";
  let providerId = "";
  let providerUserId = "";
  let categoryId = "";
  let bookingId = "";
  let disputeCaseId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `F11L5A_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Export Completeness Client",
        email: `${uid("f11l5_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Export Completeness Provider",
        email: `${uid("f11l5_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Export Completeness Provider",
        bio: "test",
        experienceYears: 2,
        priceCents: 8000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const booking = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: new Date(), priceCents: 8000, status: "COMPLETED", completedAt: new Date() }
    });
    bookingId = booking.id;

    await prisma.supportTicket.create({
      data: { userId: clientId, subject: "Duvida sobre pagamento", message: "Mensagem de suporte do teste de completude." }
    });

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "NO_SHOW_CONTESTED", status: "OPEN", clientId, providerId, amountCents: 8000, contextNote: "Nota de contexto da disputa." }
    });
    disputeCaseId = disputeCase.id;

    await prisma.debtRecord.create({
      data: { disputeCaseId, debtorType: "CLIENT", clientId, amountCents: 8000, reason: "Debito de teste de completude." }
    });

    await prisma.noShowReport.create({
      data: { bookingId, reportedUserId: providerUserId, reportedByUserId: clientId, reportReason: "Motivo do no-show relatado pelo cliente." }
    });

    await prisma.providerStudentAssessment.create({
      data: { providerId, clientId, weight: encryptSensitiveText("82kg"), bodyFatPercent: encryptSensitiveText("18%") }
    });

    const otherClient = await prisma.user.create({
      data: {
        name: "Export Completeness Follower",
        email: `${uid("f11l5_follower")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT"
      }
    });
    await prisma.follow.create({ data: { followerId: otherClient.id, followingId: clientId } });
  });

  afterAll(async () => {
    await prisma.dataExportLog.deleteMany({ where: { userId: clientId } });
    await prisma.follow.deleteMany({ where: { followingId: clientId } });
    await prisma.providerStudentAssessment.deleteMany({ where: { providerId } });
    await prisma.noShowReport.deleteMany({ where: { bookingId } });
    await prisma.debtRecord.deleteMany({ where: { disputeCaseId } });
    await prisma.disputeCase.deleteMany({ where: { id: disputeCaseId } });
    await prisma.supportTicket.deleteMany({ where: { userId: clientId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("inclui supportTickets, disputes, debtRecords, noShowReportsFiled, physicalAssessments (decifrado) e followers", async () => {
    const result = await userService.exportMyData(clientId);

    expect(result.supportTickets.some((t) => t.message.includes("Mensagem de suporte do teste"))).toBe(true);
    expect(result.disputes.some((d) => d.id === disputeCaseId)).toBe(true);
    expect(result.debtRecords.some((d) => d.reason.includes("Debito de teste"))).toBe(true);
    expect(result.noShowReportsFiled.some((r) => r.bookingId === bookingId)).toBe(true);

    const assessment = result.physicalAssessments.find((a) => a.providerId === providerId);
    expect(assessment).toBeDefined();
    expect(assessment!.weight).toBe("82kg");
    expect(assessment!.bodyFatPercent).toBe("18%");

    expect(result.followers.length).toBeGreaterThanOrEqual(1);
  });

  it("grava DataExportLog ao exportar", async () => {
    await userService.exportMyData(clientId);
    const logs = await prisma.dataExportLog.findMany({ where: { userId: clientId } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Frente 11, Lote 5 — exportMyData cobre o lado profissional", () => {
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `F11L5B_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Export Provider Side",
        email: `${uid("f11l5_provside")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Export Provider Side",
        bio: "test",
        experienceYears: 5,
        priceCents: 12000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: "Oferta de teste de completude", billingCycle: "MONTHLY", priceCents: 15000 }
    });
    offerId = offer.id;

    await prisma.availability.create({ data: { providerId, weekday: 1, startTime: "08:00", endTime: "12:00" } });

    await prisma.providerBankAccount.create({
      data: {
        providerId,
        bankName: "Banco de Teste",
        accountType: "CHECKING",
        agency: encryptSensitiveText("0001"),
        accountNumber: encryptSensitiveText("123456"),
        accountDigit: encryptSensitiveText("7"),
        holderName: encryptSensitiveText("Titular De Teste"),
        holderDocument: encryptSensitiveText("12345678900")
      }
    });
  });

  afterAll(async () => {
    await prisma.providerBankAccount.deleteMany({ where: { providerId } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.dataExportLog.deleteMany({ where: { userId: providerUserId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("providerData inclui perfil, ofertas, disponibilidade e conta bancária decifrada", async () => {
    const result = await userService.exportMyData(providerUserId);

    expect(result.providerData).not.toBeNull();
    expect(result.providerData!.profile.displayName).toBe("Export Provider Side");
    expect(result.providerData!.serviceOffers.some((o) => o.title === "Oferta de teste de completude")).toBe(true);
    expect(result.providerData!.availabilities.some((a) => a.weekday === 1)).toBe(true);
    expect(result.providerData!.bankAccount).not.toBeNull();
    expect(result.providerData!.bankAccount!.agency).toBe("0001");
    expect(result.providerData!.bankAccount!.holderDocument).toBe("12345678900");
  });
});

describe("Frente 11, Lote 5 — listas longas não são cortadas silenciosamente", () => {
  let userId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        name: "Export Truncation User",
        email: `${uid("f11l5_trunc")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: "CLIENT"
      }
    });
    userId = user.id;

    const rows = Array.from({ length: 501 }, () => ({
      userId,
      refreshTokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }));
    await prisma.session.createMany({ data: rows });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.dataExportLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("marca truncated.sessions=true e limita a 500 itens em vez de cortar sem avisar", async () => {
    const result = await userService.exportMyData(userId);
    expect(result.sessions.length).toBe(500);
    expect(result.truncated.sessions).toBe(true);
  });
});
