import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { hashValue } from "../src/shared/utils/hash";
import { AppError } from "../src/shared/errors/app-error";

// Épico de Frentes, Frente 11, Lote 6: deleteMe (exclusão de conta) tinha
// várias lacunas: legalHoldUntil nunca era checado, ConsultancyMessage
// nunca era anonimizada (mesma assimetria já corrigida do lado de
// BookingMessage), identificadores residuais (CPF, apelido, segredo de
// 2FA...) ficavam intactos numa conta "excluída", pacote/consultoria ativos
// do CLIENTE bloqueavam em vez de cancelar automaticamente (como o lado
// profissional já fazia), e várias categorias de mídia no R2 (CREF,
// exercício, comprovação de presença) nunca eram limpas.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const userService = new UserService();
const PASSWORD = "Test1234";

describe("Frente 11, Lote 6 — legal hold bloqueia a exclusão", () => {
  let userId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const hashed = await hashValue(PASSWORD);
    const user = await prisma.user.create({
      data: {
        name: "Legal Hold User",
        email: `${uid("f11l6_legalhold")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT,
        legalHoldUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        legalHoldReason: "Processo judicial em curso (teste)."
      }
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("bloqueia a exclusão com mensagem clara enquanto o legal hold estiver ativo", async () => {
    await expect(userService.deleteMe(userId, PASSWORD)).rejects.toThrow(AppError);
    await expect(userService.deleteMe(userId, PASSWORD)).rejects.toThrow(/retenção legal/i);

    const stillThere = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stillThere.name).toBe("Legal Hold User");
  });
});

describe("Frente 11, Lote 6 — identificadores residuais e ConsultancyMessage", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";
  let contractId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const hashed = await hashValue(PASSWORD);

    const client = await prisma.user.create({
      data: {
        name: "Residual Fields Client",
        email: `${uid("f11l6_residual")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT,
        document: "encriptado-fake",
        documentHash: "hash-fake",
        apelido: `apelido_${Date.now()}`,
        twoFactorSecret: "segredo-fake",
        twoFactorEnabled: true,
        mpCustomerId: "mp-customer-fake",
        mpDefaultCardId: "mp-card-fake",
        suspensionReason: "Motivo de suspensão de teste."
      }
    });
    clientId = client.id;

    const category = await prisma.serviceCategory.create({ data: { name: `F11L6_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Residual Fields Provider",
        email: `${uid("f11l6_residual_prov")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Residual Fields Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: "Consultoria de teste", billingCycle: "MONTHLY", priceCents: 20000 }
    });
    offerId = offer.id;

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId, clientId, status: "RESPONDED", quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000), respondedAt: new Date()
      }
    });

    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id, providerId, clientId, offerId,
        status: "ACTIVE", paymentMethod: "PIX", paymentInstallments: 1,
        paymentStatus: "CAPTURED", paymentAmountCents: 20000, providerAmountCents: 18000, platformAmountCents: 2000,
        billingCycle: "MONTHLY", kind: "ONLINE_CONSULTANCY",
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt: new Date()
      }
    });
    contractId = contract.id;

    await prisma.consultancyMessage.create({
      data: { contractId, senderId: clientId, content: "Mensagem original do cliente antes da exclusão." }
    });
  });

  afterAll(async () => {
    await prisma.consultancyMessage.deleteMany({ where: { contractId } });
    await prisma.consultancyContract.deleteMany({ where: { id: contractId } });
    await prisma.consultancyRequest.deleteMany({ where: { providerId, clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("limpa document/documentHash/apelido/2FA/mpCustomerId/mpDefaultCardId/suspensionReason e anonimiza ConsultancyMessage", async () => {
    await userService.deleteMe(clientId, PASSWORD);

    const cleaned = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(cleaned.document).toBeNull();
    expect(cleaned.documentHash).toBeNull();
    expect(cleaned.apelido).toBeNull();
    expect(cleaned.twoFactorSecret).toBeNull();
    expect(cleaned.twoFactorEnabled).toBe(false);
    expect(cleaned.mpCustomerId).toBeNull();
    expect(cleaned.mpDefaultCardId).toBeNull();
    expect(cleaned.suspensionReason).toBeNull();

    const message = await prisma.consultancyMessage.findFirstOrThrow({ where: { contractId } });
    expect(message.content).toBe("[Mensagem removida]");
    expect(message.senderId).toBeNull();
  });
});

describe("Frente 11, Lote 6 — pacote/consultoria ativos do cliente cancelam em vez de bloquear", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";
  let contractId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const hashed = await hashValue(PASSWORD);

    const client = await prisma.user.create({
      data: {
        name: "Auto Cancel Client",
        email: `${uid("f11l6_autocancel")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const category = await prisma.serviceCategory.create({ data: { name: `F11L6B_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Auto Cancel Provider",
        email: `${uid("f11l6_autocancel_prov")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Auto Cancel Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: "Consultoria auto-cancel", billingCycle: "MONTHLY", priceCents: 20000 }
    });
    offerId = offer.id;

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId, clientId, status: "RESPONDED", quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000), respondedAt: new Date()
      }
    });

    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id, providerId, clientId, offerId,
        status: "ACTIVE", paymentMethod: "PIX", paymentInstallments: 1,
        paymentStatus: "CAPTURED", paymentAmountCents: 20000, providerAmountCents: 18000, platformAmountCents: 2000,
        billingCycle: "MONTHLY", kind: "ONLINE_CONSULTANCY",
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt: new Date()
      }
    });
    contractId = contract.id;
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { id: contractId } });
    await prisma.consultancyRequest.deleteMany({ where: { providerId, clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("não bloqueia a exclusão - cancela a consultoria ativa automaticamente", async () => {
    await expect(userService.deleteMe(clientId, PASSWORD)).resolves.not.toThrow();

    const contract = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("CANCELLED");

    const cleaned = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(cleaned.name).toBe("Usuário removido");
  });
});

describe("Frente 11, Lote 6 — mídia órfã no R2 e post automático que citava a conta excluída", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let bookingId = "";
  let otherClientId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const hashed = await hashValue(PASSWORD);

    const category = await prisma.serviceCategory.create({ data: { name: `F11L6C_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "R2 Cleanup Client",
        email: `${uid("f11l6_r2client")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "R2 Cleanup Provider",
        email: `${uid("f11l6_r2prov")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}7`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "R2 Cleanup Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED",
        photoUrl: "https://fake-r2-public.test/provider-photos/foto.jpg",
        presentationVideoUrl: "https://fake-r2-public.test/presentation-videos/video.mp4",
        crefDocumentUrl: "cref-documents/documento-privado.pdf"
      }
    });
    providerId = provider.id;

    await prisma.exercise.create({
      data: {
        providerId, name: "Exercício de teste", category: "Peito",
        mediaUrl: "https://fake-r2-public.test/exercise-media/exercicio.mp4", isPrebuilt: false
      }
    });

    const booking = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: new Date(), priceCents: 10000, status: "COMPLETED", completedAt: new Date() }
    });
    bookingId = booking.id;

    await prisma.completionEvidence.create({
      data: { bookingId, userId: providerUserId, cameraFacing: "FRONT", mimeType: "image/jpeg", storageKey: "attendance-proofs/comprovacao-teste.enc" }
    });

    // Post automático de OUTRO cliente citando este profissional (snapshot em metadata).
    const otherClient = await prisma.user.create({
      data: {
        name: "Outro Cliente Que Citou O Provider",
        email: `${uid("f11l6_otherclient")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}8`,
        role: UserRole.CLIENT
      }
    });
    otherClientId = otherClient.id;
    await prisma.feedPost.create({
      data: {
        userId: otherClientId, type: "WORKOUT_COMPLETED", isAutomatic: true,
        metadata: { type: "PRESENTIAL", providerId, providerName: "R2 Cleanup Provider", providerPhotoUrl: "https://fake-r2-public.test/provider-photos/foto.jpg" }
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({ where: { userId: otherClientId } });
    await prisma.completionEvidence.deleteMany({ where: { bookingId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.exercise.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, otherClientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("apaga foto/vídeo/CREF/exercício/comprovação órfãos no R2 e limpa a citação no post automático de outro usuário", async () => {
    const sendSpy = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    await userService.deleteMe(providerUserId, PASSWORD);

    const deletedKeys = sendSpy.mock.calls
      .filter(([cmd]) => cmd instanceof DeleteObjectCommand)
      .map(([cmd]) => (cmd as DeleteObjectCommand).input.Key);

    expect(deletedKeys).toContain("provider-photos/foto.jpg");
    expect(deletedKeys).toContain("presentation-videos/video.mp4");
    expect(deletedKeys).toContain("cref-documents/documento-privado.pdf");
    expect(deletedKeys).toContain("exercise-media/exercicio.mp4");
    expect(deletedKeys).toContain("attendance-proofs/comprovacao-teste.enc");

    const otherPost = await prisma.feedPost.findFirstOrThrow({ where: { userId: otherClientId } });
    const metadata = otherPost.metadata as Record<string, unknown>;
    expect(metadata.providerName).toBe("Personal removido");
    expect(metadata.providerPhotoUrl).toBeNull();
  });
});
