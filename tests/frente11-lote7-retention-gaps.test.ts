import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { DataRetentionService } from "../src/modules/privacy/services/data-retention.service";
import { encryptSensitiveText, encryptJson } from "../src/shared/utils/encryption";

// Épico de Frentes, Frente 11, Lote 7: (1) ConsultancyMessage sem regra de
// retenção nenhuma (espelho de BookingMessage). (2) cleanupAnamnesis/
// cleanupBiometricAssessments redigiam dado de cliente/par ATIVO. (3) Legal
// hold checado só do lado cliente em várias regras (ex.: disputeCase),
// nunca do lado profissional.

const service = new DataRetentionService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createUser(prefix: string, role: "CLIENT" | "PROVIDER" = "CLIENT", extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      name: `${prefix} User`,
      email: `${uid(prefix)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role,
      ...extra
    }
  });
  return user.id;
}

describe("Frente 11, Lote 7 — retenção do chat de consultoria", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";
  let requestId = "";
  let contractId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `F11L7A_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    clientId = await createUser("f11l7_msg_client");
    providerUserId = await createUser("f11l7_msg_provider", "PROVIDER");
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Msg Provider", bio: "x", experienceYears: 1, priceCents: 5000, crefValidationStatus: "APPROVED" }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: `Consultoria ${uid("offer")}`, billingCycle: "MONTHLY", priceCents: 15000 }
    });
    offerId = offer.id;

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId, clientId, status: "RESPONDED", quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000), respondedAt: new Date()
      }
    });
    requestId = request.id;

    const contract = await prisma.consultancyContract.create({
      data: {
        requestId, providerId, clientId, offerId,
        status: "CANCELLED", paymentMethod: "PIX", paymentInstallments: 1,
        paymentStatus: "CANCELED", paymentAmountCents: 15000, providerAmountCents: 13000, platformAmountCents: 2000,
        billingCycle: "MONTHLY", kind: "ONLINE_CONSULTANCY",
        deliveryDeadlineAt: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000)
      }
    });
    contractId = contract.id;

    await prisma.consultancyMessage.create({
      data: {
        contractId, senderId: clientId, content: "Mensagem antiga que deveria ser redigida.",
        createdAt: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000)
      }
    });
  });

  afterAll(async () => {
    await prisma.consultancyMessage.deleteMany({ where: { contractId } });
    await prisma.consultancyContract.deleteMany({ where: { id: contractId } });
    await prisma.consultancyRequest.deleteMany({ where: { id: requestId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("redige mensagens antigas de um contrato encerrado", async () => {
    await service.run({ dryRun: false, triggeredBy: "test" });

    const message = await prisma.consultancyMessage.findFirstOrThrow({ where: { contractId } });
    expect(message.content).toBe("[CONTEUDO REMOVIDO POR RETENCAO]");
    expect(message.senderId).toBeNull();
  });
});

describe("Frente 11, Lote 7 — não redige dado de saúde de relação ativa", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let bookingId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `F11L7B_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    clientId = await createUser("f11l7_active_client");
    providerUserId = await createUser("f11l7_active_provider", "PROVIDER");
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Active Provider", bio: "x", experienceYears: 1, priceCents: 5000, crefValidationStatus: "APPROVED" }
    });
    providerId = provider.id;

    // Booking PENDING (relação ativa) - deve impedir a redação da anamnese e da avaliação biométrica.
    const booking = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000), priceCents: 5000, status: "PENDING" }
    });
    bookingId = booking.id;

    const oldDate = new Date(Date.now() - 900 * 24 * 60 * 60 * 1000);
    await prisma.clientAnamnesis.create({
      data: { clientId, status: "COMPLETED", answers: encryptJson({ x: 1 }), updatedAt: oldDate }
    });
    await prisma.providerStudentAssessment.create({
      data: { providerId, clientId, weight: encryptSensitiveText("80kg"), updatedAt: oldDate }
    });
  });

  afterAll(async () => {
    await prisma.providerStudentAssessment.deleteMany({ where: { providerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("preserva anamnese e avaliação biométrica de um cliente com booking ativo, mesmo além da janela de retenção", async () => {
    await service.run({ dryRun: false, triggeredBy: "test" });

    const anamnesis = await prisma.clientAnamnesis.findUniqueOrThrow({ where: { clientId } });
    expect(anamnesis.answers).not.toBeNull();
    expect(anamnesis.status).toBe("COMPLETED");

    const assessment = await prisma.providerStudentAssessment.findUniqueOrThrow({
      where: { providerId_clientId: { providerId, clientId } }
    });
    expect(assessment).not.toBeNull();
  });
});

describe("Frente 11, Lote 7 — legal hold protege o lado profissional", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let disputeCaseId = "";

  beforeAll(async () => {
    await prisma.$connect();
    clientId = await createUser("f11l7_hold_client");
    providerUserId = await createUser("f11l7_hold_provider", "PROVIDER", {
      legalHoldUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Hold Provider", bio: "x", experienceYears: 1, priceCents: 5000, crefValidationStatus: "APPROVED" }
    });
    providerId = provider.id;

    const dispute = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED", status: "RESOLVED", clientId, providerId, amountCents: 5000,
        contextNote: "Nota de contexto que não deve ser apagada por causa do legal hold.",
        resolvedAt: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000)
      }
    });
    disputeCaseId = dispute.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { id: disputeCaseId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("não redige contextNote de disputa de um profissional sob legal hold", async () => {
    // Mesma correção do script manual (Lote 7): resolveLegalHoldUserIds
    // busca User.legalHoldUntil persistido, não só a lista fixa.
    const legalHoldUserIds = await service.resolveLegalHoldUserIds([]);
    expect(legalHoldUserIds).toContain(providerUserId);

    await service.run({ dryRun: false, triggeredBy: "test", legalHoldUserIds });

    const dispute = await prisma.disputeCase.findUniqueOrThrow({ where: { id: disputeCaseId } });
    expect(dispute.contextNote).not.toBeNull();
  });
});
