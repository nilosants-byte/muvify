import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ExternalStudentInviteStatus,
  ConsultancyContractOrigin,
  ConsultancyContractStatus,
  BookingStatus
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { getActiveEngagementSummary } from "../src/shared/utils/client-engagement";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Bloco 2 (aluno externo): mecanismo de convite por trás do cadastro manual
// do aluno externo (Bloco 1) — token curto hasheado, preview público sem
// mutar nada, confirmação explícita do aluno, uso único.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let providerUserId = "";
let providerId = "";
let clientUserId = "";

describe("Bloco 2 — convite do aluno externo", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Convite Externo Provider",
        email: `${uid("inv_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Convite Externo Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "666555444",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "IN_REVIEW"
      }
    });
    providerId = provider.id;

    const clientUser = await prisma.user.create({
      data: {
        name: "Convite Externo Client",
        email: `${uid("inv_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "CLIENT"
      }
    });
    clientUserId = clientUser.id;
  });

  afterAll(async () => {
    await prisma.externalStudentInvite.deleteMany({ where: { providerId } });
    const requestIds = (
      await prisma.consultancyRequest.findMany({ where: { providerId }, select: { id: true } })
    ).map((r) => r.id);
    const offerIds = (
      await prisma.consultancyContract.findMany({ where: { providerId }, select: { offerId: true } })
    ).map((c) => c.offerId);
    await prisma.consultancyContract.deleteMany({ where: { providerId } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientUserId] } } });
    await prisma.$disconnect();
  });

  it("cria convite com token só hasheado no banco", async () => {
    const { invite, inviteToken } = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Mariana Costa",
      channel: "WHATSAPP",
      phone: "11900000000"
    });

    expect(invite.status).toBe(ExternalStudentInviteStatus.PENDING);
    expect(inviteToken).toHaveLength(6);

    const stored = await prisma.externalStudentInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(stored.tokenHash).not.toBe(inviteToken);
  });

  it("preview público mostra o profissional e o nome do aluno, sem exigir login", async () => {
    const { inviteToken } = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Bruno Alves",
      channel: "EMAIL",
      email: `${uid("bruno")}@test.com`
    });

    const preview = await consultancyService.previewExternalStudentInvite(inviteToken);
    expect(preview.studentName).toBe("Bruno Alves");
    expect(preview.provider.displayName).toBe("Convite Externo Provider");
  });

  it("preview rejeita token inexistente", async () => {
    await expect(consultancyService.previewExternalStudentInvite("ZZZZZZ")).rejects.toThrow(/não encontrado/i);
  });

  it("reenvio pro mesmo telefone cancela o convite pendente anterior", async () => {
    const first = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Carla Dias",
      channel: "WHATSAPP",
      phone: "11911111111"
    });

    await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Carla Dias",
      channel: "WHATSAPP",
      phone: "11911111111"
    });

    const reloaded = await prisma.externalStudentInvite.findUniqueOrThrow({ where: { id: first.invite.id } });
    expect(reloaded.status).toBe(ExternalStudentInviteStatus.CANCELLED);
  });

  it("claim confirma o vínculo, cria o contrato externo e marca o convite como usado", async () => {
    const { inviteToken } = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Diego Souza",
      channel: "WHATSAPP",
      phone: "11922222222"
    });

    const client2 = await prisma.user.create({
      data: {
        name: "Diego Souza",
        email: `${uid("diego")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "CLIENT"
      }
    });

    const contract = await consultancyService.claimExternalStudentInvite(client2.id, inviteToken);
    expect(contract.origin).toBe(ConsultancyContractOrigin.EXTERNAL);
    expect(contract.clientId).toBe(client2.id);
    expect(contract.status).toBe(ConsultancyContractStatus.ACTIVE);

    await expect(consultancyService.claimExternalStudentInvite(client2.id, inviteToken)).rejects.toThrow(
      /não está mais disponível/i
    );

    await prisma.consultancyContract.deleteMany({ where: { clientId: client2.id } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId: client2.id } });
    await prisma.user.deleteMany({ where: { id: client2.id } });
  });

  it("profissional não pode confirmar o próprio convite", async () => {
    const { inviteToken } = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Eu Mesmo",
      channel: "WHATSAPP",
      phone: "11933333333"
    });

    await expect(consultancyService.claimExternalStudentInvite(providerUserId, inviteToken)).rejects.toThrow(
      /próprio convite/i
    );
  });

  it("cancelamento impede confirmação posterior", async () => {
    const { invite, inviteToken } = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Fernanda Lima",
      channel: "WHATSAPP",
      phone: "11944444444"
    });

    await consultancyService.cancelExternalStudentInvite(providerUserId, invite.id);

    await expect(consultancyService.claimExternalStudentInvite(clientUserId, inviteToken)).rejects.toThrow(
      /não está mais disponível/i
    );
  });

  it("lista só convites pendentes do profissional (cancelado não aparece)", async () => {
    const pending = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Gabriel Rocha",
      channel: "WHATSAPP",
      phone: "11955555555"
    });

    const list = await consultancyService.listMyExternalStudentInvites(providerUserId);
    expect(list.some((i) => i.id === pending.invite.id)).toBe(true);
    expect(list.some((i) => i.studentName === "Fernanda Lima")).toBe(false);
  });

  // Realinhamento com o Will (2026-08-25): antes, aceitar um convite de
  // profissional diferente do vínculo ativo atual era bloqueado com 409
  // (regra global de exclusividade do Bloco 3). Agora o convite sempre
  // chega pro aluno decidir — aceitar TROCA o vínculo.
  it("aceitar convite de outro profissional TROCA o vínculo (cancela o agendamento avulso antigo)", async () => {
    const oldProviderUser = await prisma.user.create({
      data: {
        name: "Provider Antigo (Booking)",
        email: `${uid("old_prov")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: "PROVIDER"
      }
    });
    const oldProvider = await prisma.providerProfile.create({
      data: {
        userId: oldProviderUser.id,
        displayName: "Provider Antigo (Booking)",
        bio: "test",
        experienceYears: 3,
        priceCents: 9000,
        crefValidationStatus: "APPROVED"
      }
    });
    const category = await prisma.serviceCategory.create({ data: { name: `Bloco2Switch_${Date.now()}`, description: "t" } });

    const switchClient = await prisma.user.create({
      data: {
        name: "Switch Client",
        email: `${uid("switch_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: "CLIENT"
      }
    });

    const oldBooking = await prisma.booking.create({
      data: {
        clientId: switchClient.id,
        providerId: oldProvider.id,
        categoryId: category.id,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });

    // Confirma que o vínculo ativo é mesmo o antigo antes de trocar.
    const before = await getActiveEngagementSummary(switchClient.id);
    expect(before.hasActive).toBe(true);
    if (before.hasActive) expect(before.providerId).toBe(oldProvider.id);

    const { inviteToken } = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Switch Client",
      channel: "WHATSAPP",
      phone: "11966666666"
    });

    const newContract = await consultancyService.claimExternalStudentInvite(switchClient.id, inviteToken);
    expect(newContract.providerId).toBe(providerId);
    expect(newContract.status).toBe(ConsultancyContractStatus.ACTIVE);

    const oldBookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: oldBooking.id } });
    expect(oldBookingAfter.status).toBe(BookingStatus.CANCELLED);

    const after = await getActiveEngagementSummary(switchClient.id);
    expect(after.hasActive).toBe(true);
    if (after.hasActive) expect(after.providerId).toBe(providerId);

    await prisma.consultancyContract.deleteMany({ where: { clientId: switchClient.id } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId: switchClient.id } });
    await prisma.booking.deleteMany({ where: { clientId: switchClient.id } });
    await prisma.user.deleteMany({ where: { id: switchClient.id } });
    await prisma.providerProfile.deleteMany({ where: { id: oldProvider.id } });
    await prisma.user.deleteMany({ where: { id: oldProviderUser.id } });
    await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
  });

  it("aceitar convite de outro profissional TROCA o vínculo (cancela o contrato de consultoria paga antigo)", async () => {
    const oldProviderUser = await prisma.user.create({
      data: {
        name: "Provider Antigo (Contrato)",
        email: `${uid("old_prov2")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}7`,
        role: "PROVIDER"
      }
    });
    const oldProvider = await prisma.providerProfile.create({
      data: {
        userId: oldProviderUser.id,
        displayName: "Provider Antigo (Contrato)",
        bio: "test",
        experienceYears: 3,
        priceCents: 9000,
        crefValidationStatus: "APPROVED"
      }
    });

    const switchClient2 = await prisma.user.create({
      data: {
        name: "Switch Client 2",
        email: `${uid("switch_client2")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}8`,
        role: "CLIENT"
      }
    });

    const oldOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId: oldProvider.id,
        kind: "ONLINE_CONSULTANCY",
        title: "Plano antigo pago",
        billingCycle: "MONTHLY",
        priceCents: 9000
      }
    });
    const now = new Date();
    const oldRequest = await prisma.consultancyRequest.create({
      data: {
        providerId: oldProvider.id,
        clientId: switchClient2.id,
        status: "RESPONDED",
        quotedOfferId: oldOffer.id,
        responseDeadlineAt: now,
        respondedAt: now
      }
    });
    const oldContract = await prisma.consultancyContract.create({
      data: {
        requestId: oldRequest.id,
        providerId: oldProvider.id,
        clientId: switchClient2.id,
        offerId: oldOffer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentInstallments: 1,
        paymentStatus: "CAPTURED",
        paymentAmountCents: 9000,
        providerAmountCents: 8000,
        platformAmountCents: 1000,
        paymentCapturedAt: now,
        deliveryDeadlineAt: now,
        immediateExecutionAcknowledgedAt: now,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY"
      }
    });

    const { inviteToken } = await consultancyService.createExternalStudentInvite(providerUserId, {
      studentName: "Switch Client 2",
      channel: "WHATSAPP",
      phone: "11977777777"
    });

    const newContract = await consultancyService.claimExternalStudentInvite(switchClient2.id, inviteToken);
    expect(newContract.providerId).toBe(providerId);

    const oldContractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: oldContract.id } });
    expect(oldContractAfter.status).toBe(ConsultancyContractStatus.CANCELLED);

    await prisma.consultancyContract.deleteMany({ where: { clientId: switchClient2.id } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId: switchClient2.id } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: oldOffer.id } });
    await prisma.user.deleteMany({ where: { id: switchClient2.id } });
    await prisma.providerProfile.deleteMany({ where: { id: oldProvider.id } });
    await prisma.user.deleteMany({ where: { id: oldProviderUser.id } });
  });
});
