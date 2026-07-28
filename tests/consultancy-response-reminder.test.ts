import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Raio-X de pagamentos, Rodada 4, Lote 10: só existia o aviso de quando o
// prazo de 48h de resposta a uma solicitação de consultoria já tinha
// vencido — nenhum lembrete antes disso, ao contrário do padrão já usado
// pra confirmação de agendamento avulso (Rodada 4, Lote 4).

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
const requestIds: string[] = [];

describe("Lembrete de resposta pendente de consultoria antes do prazo vencer (Rodada 4, Lote 10)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await prisma.user.create({
      data: {
        name: "Response Reminder Client",
        email: `${uid("crr_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Response Reminder Provider",
        email: `${uid("crr_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Response Reminder Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  async function makeRequest(responseDeadlineAt: Date) {
    const request = await prisma.consultancyRequest.create({
      data: { providerId, clientId, status: "OPEN", responseDeadlineAt }
    });
    requestIds.push(request.id);
    return request;
  }

  it("envia lembrete uma única vez quando o prazo está próximo de vencer", async () => {
    const request = await makeRequest(new Date(Date.now() + 60 * 60 * 1000)); // vence em 1h

    await consultancyService.sendConsultancyResponseReminders();
    let fromDb = await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(fromDb.responseReminderSentAt).not.toBeNull();

    const sentAtFirstRun = fromDb.responseReminderSentAt;
    await consultancyService.sendConsultancyResponseReminders();
    fromDb = await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(fromDb.responseReminderSentAt?.getTime()).toBe(sentAtFirstRun?.getTime());
  });

  it("não envia lembrete quando o prazo ainda está longe (fora da janela)", async () => {
    const request = await makeRequest(new Date(Date.now() + 47 * 60 * 60 * 1000)); // vence em 47h, janela é 6h

    await consultancyService.sendConsultancyResponseReminders();
    const fromDb = await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(fromDb.responseReminderSentAt).toBeNull();
  });

  it("não envia lembrete pra solicitação que já foi respondida", async () => {
    const request = await makeRequest(new Date(Date.now() + 60 * 60 * 1000));
    await prisma.consultancyRequest.update({ where: { id: request.id }, data: { status: "RESPONDED" } });

    await consultancyService.sendConsultancyResponseReminders();
    const fromDb = await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(fromDb.responseReminderSentAt).toBeNull();
  });
});
