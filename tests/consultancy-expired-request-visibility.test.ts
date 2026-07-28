import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Raio-X de pagamentos, Rodada 4, Lote 5: ConsultancyRequestStatus.EXPIRED é
// gravado pelo job automático (expireStaleConsultancyRequests) quando o
// profissional nunca responde uma solicitação, mas as telas de arquivados
// (cliente e profissional) excluíam esse status do filtro — a solicitação
// sumia do app pra sempre, nos dois perfis.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let requestId = "";

describe("Solicitação expirada sem resposta continua visível pra cliente e profissional (Rodada 4, Lote 5)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await prisma.user.create({
      data: {
        name: "Expired Req Client",
        email: `${uid("cerv_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Expired Req Provider",
        email: `${uid("cerv_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Expired Req Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;

    const consultRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "EXPIRED",
        responseDeadlineAt: new Date(Date.now() - 60 * 60 * 1000)
      }
    });
    requestId = consultRequest.id;
  });

  afterAll(async () => {
    await prisma.consultancyRequest.deleteMany({ where: { id: requestId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("aparece no arquivo do cliente, tanto no filtro ALL quanto no filtro EXPIRED específico", async () => {
    const all = await consultancyService.listClientArchivedRequests(clientId, "ALL");
    expect(all.some((r) => r.id === requestId)).toBe(true);

    const filtered = await consultancyService.listClientArchivedRequests(clientId, "EXPIRED");
    expect(filtered.some((r) => r.id === requestId)).toBe(true);
  });

  it("aparece no arquivo do profissional, tanto no filtro ALL quanto no filtro EXPIRED específico", async () => {
    const all = await consultancyService.listProviderArchivedRequests(providerUserId, "ALL");
    expect(all.some((r) => r.id === requestId)).toBe(true);

    const filtered = await consultancyService.listProviderArchivedRequests(providerUserId, "EXPIRED");
    expect(filtered.some((r) => r.id === requestId)).toBe(true);
  });
});
