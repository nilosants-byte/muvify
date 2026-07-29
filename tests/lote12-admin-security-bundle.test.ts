import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";

// Raio-X de pagamentos, Rodada 4, Lote 12: bundle de moderados admin +
// segurança. Cobre os 3 itens com lógica de negócio nova: contador de
// reprovações de CREF (nunca reseta, diferente do motivo que é sobrescrito),
// indicadores de dívida/disputa/suspensão nos tickets de suporte, e o teto
// no valor de chargeClientDebtCents em resolveCase.

const providerService = new ProviderService();
const adminService = new AdminService();
const disputeCaseService = new DisputeCaseService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let adminId = "";
const ticketIds: string[] = [];
const disputeCaseIds: string[] = [];

describe("Bundle de moderados — Admin + Segurança (Rodada 4, Lote 12)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await prisma.user.create({
      data: {
        name: "Lote Doze Client",
        email: `${uid("l12_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Lote Doze Provider",
        email: `${uid("l12_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote Doze Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefNumber: "123456-SP",
        crefValidationStatus: "IN_REVIEW",
        credentialDocuments: [
          { name: "frente", uri: "https://example.com/front.jpg" },
          { name: "verso", uri: "https://example.com/back.jpg" }
        ]
      }
    });
    providerId = provider.id;

    const adminReg = await prisma.user
      .create({
        data: {
          name: "Lote Doze Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}3`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeCaseIds } } });
    await prisma.supportTicket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("crefRejectionCount incrementa a cada reprovação e nunca reseta, mesmo quando finalmente aprovado", async () => {
    const afterFirstReject = await providerService.reviewProviderCref(adminId, providerId, {
      decision: "REJECT",
      justification: "Documento ilegível."
    });
    expect(afterFirstReject.crefRejectionCount).toBe(1);
    expect(afterFirstReject.crefRejectionReason).toBe("Documento ilegível.");

    // Novo envio de credenciais volta pro estado IN_REVIEW pra poder ser revisado de novo.
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { crefValidationStatus: "IN_REVIEW" }
    });

    const afterSecondReject = await providerService.reviewProviderCref(adminId, providerId, {
      decision: "REJECT",
      justification: "CREF vencido."
    });
    expect(afterSecondReject.crefRejectionCount).toBe(2);
    expect(afterSecondReject.crefRejectionReason).toBe("CREF vencido.");

    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { crefValidationStatus: "IN_REVIEW" }
    });

    const afterApprove = await providerService.reviewProviderCref(adminId, providerId, { decision: "APPROVE" });
    expect(afterApprove.crefValidationStatus).toBe("APPROVED");
    expect(afterApprove.crefRejectionReason).toBeNull();
    // O motivo mais recente some (sobrescrito), mas o contador de vida inteira permanece.
    expect(afterApprove.crefRejectionCount).toBe(2);
  });

  it("listSupportTickets sinaliza dívida em aberto, disputa em aberto e suspensão do usuário relacionado", async () => {
    const ticket = await prisma.supportTicket.create({
      data: { userId: clientId, subject: "Preciso de ajuda", message: "Mensagem de teste", status: "OPEN" }
    });
    ticketIds.push(ticket.id);

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000, status: "OPEN" }
    });
    disputeCaseIds.push(disputeCase.id);

    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste de indicador",
        status: "PENDING"
      }
    });

    const tickets = await adminService.listSupportTickets({ status: "OPEN", take: 200 });
    const found = tickets.find((t) => t.id === ticket.id);
    expect(found).toBeDefined();
    expect(found?.indicators.hasOpenDispute).toBe(true);
    expect(found?.indicators.hasOpenDebt).toBe(true);
    expect(found?.indicators.isSuspended).toBe(false);

    await prisma.debtRecord.deleteMany({ where: { id: debt.id } });
  });

  it("resolveCase: chargeClientDebtCents não pode exceder o valor histórico do próprio caso", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    disputeCaseIds.push(disputeCase.id);

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, {
        resolution: "DENIED",
        note: "Aluno já foi reembolsado indevidamente antes.",
        chargeClientDebtCents: 50000 // 10x o valor do caso — deve ser rejeitado
      })
    ).rejects.toThrow(/inválido/i);

    const stillOpen = await prisma.disputeCase.findUniqueOrThrow({ where: { id: disputeCase.id } });
    expect(stillOpen.status).toBe("OPEN");
  });

  // Raio-X de pagamentos, Rodada 5, Lote 6 (cobertura de testes): o teste
  // acima só cobria "muito acima do teto" — nem o valor exatamente no limite
  // (deveria aceitar) nem o limite+1 (deveria rejeitar) tinham teste. Um bug
  // de > vs >= na comparação passaria despercebido.
  it("resolveCase: chargeClientDebtCents aceita o valor exatamente igual ao teto do caso", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    disputeCaseIds.push(disputeCase.id);

    const resolved = await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "DENIED",
      note: "Aluno já foi reembolsado indevidamente antes, no valor exato do caso.",
      chargeClientDebtCents: 5000
    });
    expect(resolved.status).toBe("RESOLVED");

    const debt = await prisma.debtRecord.findFirst({ where: { disputeCaseId: disputeCase.id } });
    expect(debt?.amountCents).toBe(5000);
    await prisma.debtRecord.deleteMany({ where: { disputeCaseId: disputeCase.id } });
  });

  it("resolveCase: chargeClientDebtCents rejeita o valor um centavo acima do teto do caso", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    disputeCaseIds.push(disputeCase.id);

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, {
        resolution: "DENIED",
        note: "Tentativa de cobrar 1 centavo acima do valor do caso.",
        chargeClientDebtCents: 5001
      })
    ).rejects.toThrow(/inválido/i);

    const stillOpen = await prisma.disputeCase.findUniqueOrThrow({ where: { id: disputeCase.id } });
    expect(stillOpen.status).toBe("OPEN");
  });
});
