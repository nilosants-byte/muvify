import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";

// Épico de Frentes, Frente 3 (Cadastro/onboarding), Lote 3:
// (1) resubmissão de CREF sem reenviar `credentials` preserva os documentos
//     já enviados, em vez de apagá-los.
// (2) cooldown de resubmissão cresce a cada rejeição sucessiva.
// (3) admin ganha uma ação de verdade pra trocar o role de um usuário
//     (CLIENT/PROVIDER), com audit log.
// (4) anamnese completa passa a ser exigida no servidor pra agendamento
//     presencial e pacote presencial, não só na UI do mobile.

const providerService = new ProviderService();
const adminService = new AdminService();
const bookingService = new BookingService();
const presentialPackageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let adminId = "";
const userIds: string[] = [];
const providerIds: string[] = [];

describe("Frente 3, Lote 3 — integridade de onboarding (profissional e cliente)", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const adminReg = await prisma.user
      .create({
        data: {
          name: "Lote3 Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}7`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("resubmissão sem `credentials` preserva os documentos já enviados", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Preserva Docs",
        email: `${uid("preserve")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "PROVIDER"
      }
    });
    userIds.push(user.id);
    const initialProfile = await prisma.providerProfile.create({
      data: { userId: user.id, displayName: "Preserva Docs", bio: "test", experienceYears: 2, priceCents: 10000 }
    });
    providerIds.push(initialProfile.id);

    const created = await providerService.upsertOwnCredentials(user.id, {
      crefNumber: `PRES-${uid("a")}`,
      credentials: [
        { name: "frente", uri: "https://example.com/front.jpg" },
        { name: "verso", uri: "https://example.com/back.jpg" }
      ]
    });
    const provider = await prisma.providerProfile.findUniqueOrThrow({ where: { userId: user.id } });
    providerIds.push(provider.id);
    expect(created.crefValidationStatus).toBe("IN_REVIEW");

    // Resubmissão só corrigindo o número do CREF, sem reenviar `credentials`.
    const resubmitted = await providerService.upsertOwnCredentials(user.id, {
      crefNumber: `PRES-${uid("b")}`
    });

    expect(resubmitted.credentials?.length ?? 0).toBe(2);
    expect(resubmitted.crefValidationStatus).toBe("IN_REVIEW");
  });

  it("cooldown de resubmissão cresce a cada rejeição sucessiva", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Cooldown Crescente",
        email: `${uid("cooldown")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    userIds.push(user.id);
    const provider = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        displayName: "Cooldown Test",
        bio: "test",
        experienceYears: 2,
        priceCents: 10000,
        crefValidationStatus: "REJECTED",
        crefRejectionCount: 2,
        // 10 dias atrás - já passou do cooldown antigo fixo de 7 dias, mas
        // não do cooldown crescente esperado pra 2 rejeições (14 dias).
        crefReviewedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      }
    });
    providerIds.push(provider.id);

    await expect(
      providerService.upsertOwnCredentials(user.id, {
        crefNumber: `COOL-${uid("x")}`,
        credentials: [
          { name: "frente", uri: "https://example.com/front.jpg" },
          { name: "verso", uri: "https://example.com/back.jpg" }
        ]
      })
    ).rejects.toThrow(/dispon[íi]vel em/i);
  });

  it("admin troca o role de um usuário e registra no audit log", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Trocou Errado",
        email: `${uid("wrongrole")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "PROVIDER"
      }
    });
    userIds.push(user.id);

    const updated = await adminService.changeUserRole(adminId, user.id, "CLIENT", "Usuário abriu chamado pedindo troca para conta de cliente.");
    expect(updated.role).toBe("CLIENT");

    let auditLog = null;
    for (let attempt = 0; attempt < 5 && !auditLog; attempt++) {
      auditLog = await prisma.adminAuditLog.findFirst({
        where: { action: "USER_ROLE_CHANGED", targetId: user.id },
        orderBy: { createdAt: "desc" }
      });
      if (!auditLog) await sleep(150);
    }
    expect(auditLog).not.toBeNull();
    expect((auditLog?.metadata as any)?.toRole).toBe("CLIENT");
  });

  it("admin não consegue trocar role de usuário que já tem perfil profissional criado", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Ja Tem Perfil",
        email: `${uid("hasprofile")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "PROVIDER"
      }
    });
    userIds.push(user.id);
    const provider = await prisma.providerProfile.create({
      data: { userId: user.id, displayName: "Ja Tem Perfil", bio: "test", experienceYears: 2, priceCents: 10000 }
    });
    providerIds.push(provider.id);

    await expect(adminService.changeUserRole(adminId, user.id, "CLIENT", "Tentativa de troca")).rejects.toThrow(
      /perfil profissional criado/i
    );
  });

  it("bloqueia agendamento presencial sem anamnese completa (checagem no servidor)", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Cliente Sem Anamnese",
        email: `${uid("noanamnesis")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: "CLIENT"
      }
    });
    userIds.push(client.id);

    const providerUser = await prisma.user.create({
      data: {
        name: "Provider Anamnese",
        email: `${uid("provanamnesis")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: "PROVIDER"
      }
    });
    userIds.push(providerUser.id);
    const category = await prisma.serviceCategory.create({ data: { name: `ANM_${uid("c")}`, description: "test" } });
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: "Provider Anamnese",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerIds.push(provider.id);
    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId: provider.id,
        weekday,
        startTime: "06:00",
        endTime: "22:00",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId: provider.id, categoryId: category.id } });

    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 10);
    scheduledAt.setHours(14, 0, 0, 0);

    await expect(
      bookingService.create(client.id, provider.id, category.id, scheduledAt.toISOString(), undefined, "CREDIT_CARD" as any)
    ).rejects.toThrow(/anamnese/i);

    await prisma.availability.deleteMany({ where: { providerId: provider.id } });
    await prisma.providerCategory.deleteMany({ where: { providerId: provider.id } });
    await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
  });
});
