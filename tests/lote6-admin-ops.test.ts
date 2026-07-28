import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { DebtService } from "../src/modules/payments/services/debt.service";
import { FinancialService } from "../src/modules/financial/services/financial.service";
import { ExerciseService } from "../src/modules/exercises/services/exercise.service";
import { UserService } from "../src/modules/users/services/user.service";

// Raio-X de pagamentos, Rodada 3, Lote 6: bundle de ajustes operacionais de
// baixo risco. Cobre os itens com lógica de negócio real: baixa de dívida
// incobrável (WRITTEN_OFF nunca era setado por ninguém), exportação CSV de
// transações, audit log no CRUD de exercícios pré-montados, e a correção de
// não anonimizar tickets de suporte na exclusão de conta antes do prazo de
// retenção de 5 anos prometido na Política de Privacidade.

const debtService = new DebtService();
const financialService = new FinancialService();
const exerciseService = new ExerciseService();
const userService = new UserService();

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// writeAdminAuditLog é fire-and-forget (void) em todo lugar que chama —
// poll curto em vez de assumir que a escrita já terminou (mesmo cuidado
// já visto em Lotes 1 e 3).
async function pollAuditLogs(where: Record<string, unknown>, minCount: number) {
  let rows: Array<{ action: string }> = [];
  for (let attempt = 0; attempt < 10 && rows.length < minCount; attempt++) {
    rows = await prisma.adminAuditLog.findMany({ where, select: { action: true } });
    if (rows.length < minCount) await sleep(150);
  }
  return rows;
}

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER", email?: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: email ?? `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { userId: reg.body.user.id as string };
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let adminId = "";
const debtIds: string[] = [];
const disputeCaseIds: string[] = [];
const exerciseIds: string[] = [];

describe("Ajustes operacionais de baixo risco (Rodada 3, Lote 6)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `L6_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await registerUser("l6_client", "Lote Seis Client");
    clientId = client.userId;

    const provider = await registerUser("l6_provider", "Lote Seis Provider", "PROVIDER");
    providerUserId = provider.userId;
    const providerProfile = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote Seis Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 8000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = providerProfile.id;

    // E-mail admin compartilhado com outros arquivos rodando em paralelo —
    // reaproveita se outro arquivo já registrou primeiro (mesmo padrão do
    // Lote 3/4).
    const adminReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Lote Seis Admin",
        email: env.ADMIN_ALLOWED_EMAILS[0],
        password: PASSWORD,
        phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;
  });

  afterAll(async () => {
    await prisma.exercise.deleteMany({ where: { id: { in: exerciseIds } } });
    await prisma.debtRecord.deleteMany({ where: { id: { in: debtIds } } });
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeCaseIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    // Não apaga a conta admin: compartilhada com outros arquivos em paralelo.
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("admin lista dívidas agregadas e dá baixa (WRITTEN_OFF) numa pendência", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    disputeCaseIds.push(disputeCase.id);

    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 5000,
        reason: "teste lote 6",
        status: "NOTIFIED"
      }
    });
    debtIds.push(debt.id);

    const list = await debtService.listAllDebts(adminId, "NOTIFIED");
    expect(list.some((d) => d.id === debt.id)).toBe(true);

    const writtenOff = await debtService.writeOffDebt(adminId, debt.id, "Valor irrisório, custo de cobrança maior.");
    expect(writtenOff.status).toBe("WRITTEN_OFF");

    await expect(debtService.writeOffDebt(adminId, debt.id, "tentativa duplicada")).rejects.toThrow();

    const auditLogs = await pollAuditLogs({ adminId, action: "DEBT_WRITTEN_OFF", targetId: debt.id }, 1);
    expect(auditLogs.length).toBeGreaterThan(0);
  });

  it("exportTransactionsCsv gera um CSV valido com cabecalho e uma linha por transacao", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: "COMPLETED"
      }
    });
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: "CREDIT_CARD",
        status: "CAPTURED",
        capturedAt: new Date(),
        mpPaymentId: `mp_${uid("csv")}`
      }
    });

    const csv = await financialService.exportTransactionsCsv(providerUserId);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("data,tipo,metodo,status,valor_bruto,comissao_plataforma,valor_liquido,valor_estornado_cliente");
    expect(lines.length).toBeGreaterThan(1);
    expect(csv).toContain("90.00");

    await prisma.payment.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
  });

  it("CRUD de exercicio pre-montado grava audit log em cada acao", async () => {
    const created = await exerciseService.createPrebuilt(adminId, {
      name: `Supino ${uid("ex")}`,
      category: "Peito"
    });
    exerciseIds.push(created.id);

    await exerciseService.updatePrebuilt(adminId, created.id, { description: "atualizado" });
    await exerciseService.deletePrebuilt(adminId, created.id);
    exerciseIds.splice(exerciseIds.indexOf(created.id), 1);

    const actions = await pollAuditLogs({ adminId, targetId: created.id }, 3);
    const actionNames = actions.map((a) => a.action).sort();
    expect(actionNames).toEqual(
      ["EXERCISE_PREBUILT_CREATED", "EXERCISE_PREBUILT_DELETED", "EXERCISE_PREBUILT_UPDATED"].sort()
    );
  });

  it("exclusao de conta preserva o conteudo do ticket de suporte dentro do prazo de retencao de 5 anos", async () => {
    const deletableClient = await registerUser("l6_deletable", "Lote Seis Deletable Client");

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: deletableClient.userId,
        subject: "Assunto original do ticket",
        message: "Mensagem original detalhando o problema.",
        status: "OPEN"
      }
    });

    await userService.deleteMe(deletableClient.userId, PASSWORD);

    const afterDeletion = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(afterDeletion.subject).toBe("Assunto original do ticket");
    expect(afterDeletion.message).toBe("Mensagem original detalhando o problema.");

    const userAfterDeletion = await prisma.user.findUniqueOrThrow({ where: { id: deletableClient.userId } });
    expect(userAfterDeletion.name).toBe("Usuário removido");

    await prisma.supportTicket.delete({ where: { id: ticket.id } });
    await prisma.session.deleteMany({ where: { userId: deletableClient.userId } });
    await prisma.user.delete({ where: { id: deletableClient.userId } });
  });
});
