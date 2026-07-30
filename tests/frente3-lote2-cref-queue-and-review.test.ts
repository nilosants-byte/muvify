import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ProviderService } from "../src/modules/providers/services/provider.service";

// Épico de Frentes, Frente 3 (Cadastro/onboarding), Lote 2:
// (1) fila ordena por crefSubmittedAt (submissão real), não updatedAt.
// (2) fila suporta paginação (offset/take) com total/hasMore.
// (3) reviewProviderCref é atômico - duas revisões concorrentes não geram
//     estado contraditório.
// (4) motivo de rejeição anterior sobrevive à resubmissão, até a próxima
//     decisão do admin.
// (5) checagem de CREF duplicado normaliza pontuação/zeros à esquerda.

const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createProviderWithCref(
  crefNumber: string,
  status: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED",
  extra: { crefSubmittedAt?: Date; crefRejectionReason?: string } = {}
) {
  const user = await prisma.user.create({
    data: {
      name: `Cref ${uid("user")}`,
      email: `${uid("cref_user")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "PROVIDER"
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
      crefSubmittedAt: extra.crefSubmittedAt,
      crefRejectionReason: extra.crefRejectionReason,
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

describe("Frente 3, Lote 2 — fila e revisão de CREF", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const adminReg = await prisma.user
      .create({
        data: {
          name: "Lote2 Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}8`,
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

  it("ordena a fila pela ordem real de submissão (crefSubmittedAt), não por updatedAt", async () => {
    const older = await createProviderWithCref(`ORD-${uid("a")}`, "IN_REVIEW", {
      crefSubmittedAt: new Date(Date.now() - 60_000)
    });
    userIds.push(older.userId);
    providerIds.push(older.providerId);

    const newer = await createProviderWithCref(`ORD-${uid("b")}`, "IN_REVIEW", {
      crefSubmittedAt: new Date()
    });
    userIds.push(newer.userId);
    providerIds.push(newer.providerId);

    // Simula edição de bio no perfil mais novo, que bumpa updatedAt sem
    // tocar o CREF - antes isso jogava esse perfil pro topo da fila.
    await prisma.providerProfile.update({
      where: { id: newer.providerId },
      data: { bio: "bio editada depois, sem tocar no CREF" }
    });

    const page = await providerService.listCrefValidationQueue(adminId, "IN_REVIEW", 200, 0);
    const olderIndex = page.items.findIndex((item) => item.providerId === older.providerId);
    const newerIndex = page.items.findIndex((item) => item.providerId === newer.providerId);
    expect(olderIndex).toBeGreaterThanOrEqual(0);
    expect(newerIndex).toBeGreaterThanOrEqual(0);
    expect(olderIndex).toBeLessThan(newerIndex);
  });

  it("pagina a fila com offset/take e informa total/hasMore", async () => {
    const crefBase = uid("pg");
    const created = [];
    for (let i = 0; i < 3; i++) {
      const p = await createProviderWithCref(`PG-${crefBase}-${i}`, "IN_REVIEW", {
        crefSubmittedAt: new Date(Date.now() - (3 - i) * 1000)
      });
      userIds.push(p.userId);
      providerIds.push(p.providerId);
      created.push(p);
    }

    const firstPage = await providerService.listCrefValidationQueue(adminId, "IN_REVIEW", 200, 0);
    const total = firstPage.total;
    expect(total).toBeGreaterThanOrEqual(3);

    const onePerPage = await providerService.listCrefValidationQueue(adminId, "IN_REVIEW", 1, 0);
    expect(onePerPage.items.length).toBe(1);
    expect(onePerPage.take).toBe(1);
    expect(onePerPage.offset).toBe(0);
    expect(onePerPage.hasMore).toBe(true);

    const secondItemPage = await providerService.listCrefValidationQueue(adminId, "IN_REVIEW", 1, 1);
    expect(secondItemPage.items.length).toBe(1);
    expect(secondItemPage.items[0].providerId).not.toBe(onePerPage.items[0].providerId);
  });

  it("duas revisões concorrentes do mesmo profissional não geram estado contraditório", async () => {
    const p = await createProviderWithCref(`RACE-${uid("x")}`, "IN_REVIEW", {
      crefSubmittedAt: new Date()
    });
    userIds.push(p.userId);
    providerIds.push(p.providerId);

    const [approveResult, rejectResult] = await Promise.allSettled([
      providerService.reviewProviderCref(adminId, p.providerId, { decision: "APPROVE" }),
      providerService.reviewProviderCref(adminId, p.providerId, {
        decision: "REJECT",
        justification: "Tentativa concorrente de reprovação."
      })
    ]);

    const settled = [approveResult, rejectResult];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    // Exatamente uma das duas vence - a outra recebe erro claro de conflito,
    // nunca as duas "sucedendo" e sobrescrevendo uma à outra.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const final = await prisma.providerProfile.findUniqueOrThrow({ where: { id: p.providerId } });
    expect(["APPROVED", "REJECTED"]).toContain(final.crefValidationStatus);
  });

  it("motivo de rejeição anterior sobrevive à resubmissão, até a próxima decisão", async () => {
    const p = await createProviderWithCref(`HIST-${uid("y")}`, "REJECTED", {
      crefRejectionReason: "Documento ilegível na primeira tentativa."
    });
    userIds.push(p.userId);
    providerIds.push(p.providerId);

    const resubmitted = await providerService.upsertOwnCredentials(p.userId, {
      crefNumber: `HIST-${uid("y2")}`,
      credentials: [
        { name: "frente", uri: "https://example.com/front2.jpg" },
        { name: "verso", uri: "https://example.com/back2.jpg" }
      ]
    });

    expect(resubmitted.crefValidationStatus).toBe("IN_REVIEW");
    expect(resubmitted.crefRejectionReason).toBe("Documento ilegível na primeira tentativa.");

    const approved = await providerService.reviewProviderCref(adminId, p.providerId, { decision: "APPROVE" });
    expect(approved.crefRejectionReason).toBeNull();
  });

  it("checagem de CREF duplicado reconhece pontuação e zero à esquerda diferentes", async () => {
    const original = await createProviderWithCref("012345-SP", "APPROVED");
    userIds.push(original.userId);
    providerIds.push(original.providerId);

    const impostor = await createProviderWithCref("12345/SP", "IN_REVIEW");
    userIds.push(impostor.userId);
    providerIds.push(impostor.providerId);

    await expect(
      providerService.reviewProviderCref(adminId, impostor.providerId, { decision: "APPROVE" })
    ).rejects.toThrow(/já foi usado em outro perfil/i);
  });
});
