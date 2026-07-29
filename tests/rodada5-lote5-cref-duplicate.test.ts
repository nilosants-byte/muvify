import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ProviderService } from "../src/modules/providers/services/provider.service";

// Raio-X de pagamentos, Rodada 5, Lote 5 (auditoria adversarial): profissional
// suspenso ou com CREF rejeitado podia recriar conta com e-mail novo e
// resubmeter o mesmo CREF sem nenhum bloqueio automático. reviewProviderCref
// agora recusa aprovar um CREF que já pertence a outro perfil aprovado,
// rejeitado ou suspenso.

const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createProviderWithCref(crefNumber: string, status: "IN_REVIEW" | "APPROVED" | "REJECTED", suspended = false) {
  const user = await prisma.user.create({
    data: {
      name: `Cref ${uid("user")}`,
      email: `${uid("cref_user")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "PROVIDER",
      suspendedAt: suspended ? new Date() : null
    }
  });
  const provider = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: "Cref Test Provider",
      bio: "test",
      experienceYears: 3,
      priceCents: 10000,
      crefNumber,
      crefValidationStatus: status,
      credentialDocuments: [
        { name: "frente", uri: "https://example.com/front.jpg" },
        { name: "verso", uri: "https://example.com/back.jpg" }
      ]
    }
  });
  return { userId: user.id, providerId: provider.id };
}

let adminId = "";
const userIds: string[] = [];
const providerIds: string[] = [];

describe("Rodada 5, Lote 5 — duplicidade de identidade no CREF", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const adminReg = await prisma.user
      .create({
        data: {
          name: "Lote5 Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("recusa aprovar um CREF já aprovado em outro perfil", async () => {
    const crefNumber = `DUP-${uid("a")}`;
    const original = await createProviderWithCref(crefNumber, "APPROVED");
    userIds.push(original.userId);
    providerIds.push(original.providerId);

    const impostor = await createProviderWithCref(crefNumber, "IN_REVIEW");
    userIds.push(impostor.userId);
    providerIds.push(impostor.providerId);

    await expect(
      providerService.reviewProviderCref(adminId, impostor.providerId, { decision: "APPROVE" })
    ).rejects.toThrow(/já foi usado em outro perfil/i);

    const afterAttempt = await prisma.providerProfile.findUniqueOrThrow({ where: { id: impostor.providerId } });
    expect(afterAttempt.crefValidationStatus).toBe("IN_REVIEW");
  });

  it("recusa aprovar um CREF que pertence a um perfil suspenso", async () => {
    const crefNumber = `DUP-${uid("b")}`;
    const original = await createProviderWithCref(crefNumber, "APPROVED", true);
    userIds.push(original.userId);
    providerIds.push(original.providerId);

    const impostor = await createProviderWithCref(crefNumber, "IN_REVIEW");
    userIds.push(impostor.userId);
    providerIds.push(impostor.providerId);

    await expect(
      providerService.reviewProviderCref(adminId, impostor.providerId, { decision: "APPROVE" })
    ).rejects.toThrow(/já foi usado em outro perfil/i);
  });

  it("recusa aprovar um CREF já rejeitado em outro perfil", async () => {
    const crefNumber = `DUP-${uid("c")}`;
    const original = await createProviderWithCref(crefNumber, "REJECTED");
    userIds.push(original.userId);
    providerIds.push(original.providerId);

    const impostor = await createProviderWithCref(crefNumber, "IN_REVIEW");
    userIds.push(impostor.userId);
    providerIds.push(impostor.providerId);

    await expect(
      providerService.reviewProviderCref(adminId, impostor.providerId, { decision: "APPROVE" })
    ).rejects.toThrow(/já foi usado em outro perfil/i);
  });

  it("aprova normalmente quando o CREF é único (sem falso positivo)", async () => {
    const crefNumber = `UNIQUE-${uid("d")}`;
    const provider = await createProviderWithCref(crefNumber, "IN_REVIEW");
    userIds.push(provider.userId);
    providerIds.push(provider.providerId);

    const approved = await providerService.reviewProviderCref(adminId, provider.providerId, { decision: "APPROVE" });
    expect(approved.crefValidationStatus).toBe("APPROVED");
  });

  it("rejeitar um CREF continua funcionando mesmo quando já existe um duplicado (a checagem só bloqueia aprovação)", async () => {
    const crefNumber = `DUP-${uid("e")}`;
    const original = await createProviderWithCref(crefNumber, "APPROVED");
    userIds.push(original.userId);
    providerIds.push(original.providerId);

    const impostor = await createProviderWithCref(crefNumber, "IN_REVIEW");
    userIds.push(impostor.userId);
    providerIds.push(impostor.providerId);

    const rejected = await providerService.reviewProviderCref(adminId, impostor.providerId, {
      decision: "REJECT",
      justification: "Possível duplicidade — revisar manualmente."
    });
    expect(rejected.crefValidationStatus).toBe("REJECTED");
  });
});
