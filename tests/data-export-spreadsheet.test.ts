import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import ExcelJS from "exceljs";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { EmailService } from "../src/shared/services/email.service";
import { buildDataExportWorkbook } from "../src/modules/users/services/data-export-spreadsheet";

// A exportação de dados pessoais (LGPD) só existia em JSON - ilegível pra
// quem não é técnico. A planilha (.xlsx) é a versão legível: abas por
// assunto, títulos em português, datas em horário de Brasília, valores em R$
// e status traduzidos. O JSON continua sendo a cópia completa/interoperável.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function emptyPayload(overrides: Record<string, unknown> = {}) {
  return {
    exportedAt: "2026-09-28T15:30:00.000Z",
    profile: {
      id: "u1", name: "Maria Silva", email: "maria@test.com", phone: "11999990000", photoUrl: null,
      role: "CLIENT", termsAcceptedAt: new Date("2026-08-01T12:00:00Z"), privacyPolicyAcceptedAt: null,
      termsVersion: "v1", createdAt: new Date("2026-08-01T12:00:00Z"), updatedAt: new Date("2026-08-02T12:00:00Z")
    },
    bookings: [], reviews: [], consultancyRequests: [], consultancyContracts: [], trainingPlanCompletions: [],
    anamnesis: null, notificationPreferences: [], chatMessages: [], favorites: [], following: [], followers: [],
    feedPosts: [], feedPostLikes: [], feedPostComments: [], feedPostReports: [], bookingMessageReports: [],
    consultancyMessageReports: [], unlockedAchievements: [], supportTickets: [], disputes: [],
    noShowReportsFiled: [], noShowReportsReceived: [], debtRecords: [], physicalAssessments: [],
    consultancyMessages: [], presentialPackages: [], pushDevices: [], sessions: [], xpTransactions: [],
    consentRecords: [], completionEvidences: [], crefDocumentUploads: [], streak: null, rankingSnapshots: [],
    customerPaymentMethods: [], providerData: null, truncated: {},
    ...overrides
  } as any;
}

async function load(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return workbook;
}

describe("Planilha de exportação de dados pessoais", () => {
  it("traduz status, formata datas em horário de Brasília e valores em R$", async () => {
    const buffer = await buildDataExportWorkbook(emptyPayload({
      bookings: [{
        id: "b1",
        // 23h30 de Brasília = 02h30 UTC do dia seguinte
        scheduledAt: new Date("2026-09-28T02:30:00.000Z"),
        status: "COMPLETED", priceCents: 15050, currency: "BRL", notes: "Levar toalha",
        createdAt: new Date("2026-09-20T12:00:00.000Z"),
        payment: { method: "PIX", status: "PARTIALLY_REFUNDED", amountCents: 15050, authorizedAt: null, capturedAt: new Date("2026-09-28T03:00:00.000Z"), refundedAt: null }
      }]
    }));
    const workbook = await load(buffer);

    const sheet = workbook.getWorksheet("Agendamentos")!;
    expect(sheet).toBeDefined();
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(header).toContain("Situação do pagamento");

    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBe("27/09/2026 23:30");
    expect(row.getCell(2).value).toBe("Concluído");
    expect(row.getCell(3).value).toBe(150.5);
    expect(row.getCell(3).numFmt).toContain("R$");
    expect(row.getCell(4).value).toBe("Pix");
    expect(row.getCell(5).value).toBe("Reembolsado em parte");
  });

  it("aba 'Meus dados' traz o cadastro com o tipo de conta em português, sem a URL da foto", async () => {
    const workbook = await load(await buildDataExportWorkbook(emptyPayload()));
    const sheet = workbook.getWorksheet("Meus dados")!;
    const rows: Record<string, unknown> = {};
    sheet.eachRow((r, i) => { if (i > 1) rows[String(r.getCell(1).value)] = r.getCell(2).value; });
    expect(rows["Nome"]).toBe("Maria Silva");
    expect(rows["Tipo de conta"]).toBe("Aluno");
    expect(rows["Política de privacidade aceita em"]).toBe("");
    expect(Object.keys(rows)).not.toContain("photoUrl");
  });

  it("'Resumo' aponta a aba de cada dado e marca o que só existe no arquivo técnico", async () => {
    const workbook = await load(await buildDataExportWorkbook(emptyPayload({
      supportTickets: [{ id: "t1", subject: null, message: "oi", status: "ANSWERED", adminResponse: "olá", respondedAt: null, createdAt: new Date() }],
      followers: [{ id: "f1", followerId: "x", createdAt: new Date() }]
    })));
    const summary = workbook.getWorksheet("Resumo")!;
    const byLabel: Record<string, { count: unknown; where: unknown }> = {};
    summary.eachRow((r, i) => { if (i > 1) byLabel[String(r.getCell(1).value)] = { count: r.getCell(2).value, where: r.getCell(3).value }; });

    expect(byLabel["Chamados de suporte"]).toEqual({ count: 1, where: 'Aba "Chamados de suporte"' });
    expect(byLabel["Agendamentos e pagamentos"]).toEqual({ count: 0, where: "Sem registros" });
    expect(byLabel["Quem você segue e quem segue você"]).toEqual({ count: 1, where: "Somente no arquivo técnico (JSON)" });
    expect(workbook.getWorksheet("Chamados de suporte")!.getRow(2).getCell(4).value).toBe("Respondido");
  });

  it("não cria aba vazia e só cria as abas de profissional quando existe perfil profissional", async () => {
    const client = await load(await buildDataExportWorkbook(emptyPayload()));
    expect(client.getWorksheet("Agendamentos")).toBeUndefined();
    expect(client.getWorksheet("Receitas")).toBeUndefined();

    const provider = await load(await buildDataExportWorkbook(emptyPayload({
      profile: { ...emptyPayload().profile, role: "PROVIDER" },
      providerData: {
        profile: { id: "p1", displayName: "Personal Ana", bio: "bio", experienceYears: 5, priceCents: 12000, serviceMode: "BOTH", crefNumber: "123456-G/SP", crefValidationStatus: "APPROVED", specialties: ["Hipertrofia", "Funcional"], categories: ["Musculação"], createdAt: new Date(), updatedAt: new Date() },
        availabilities: [{ weekday: 1, startTime: "08:00", endTime: "09:00", isActive: true }],
        serviceOffers: [], bookingsReceived: [], reviewsReceived: [], consultancyRequestsReceived: [],
        consultancyContractsAsProvider: [], presentialPackagesOffered: [], disputeCases: [], bankAccount: null, debtRecords: [],
        financialStudents: [], financialIncomes: [{ id: "i1", description: "Sessão avulsa", amountCents: 9000, source: "MANUAL", paidAt: new Date("2026-09-10T15:00:00Z"), createdAt: new Date() }],
        financialExpenses: [], financialGoals: []
      }
    })));
    expect(provider.getWorksheet("Receitas")).toBeDefined();
    expect(provider.getWorksheet("Receitas")!.getRow(2).getCell(4).value).toBe("Lançamento manual");
    expect(provider.getWorksheet("Horários de atendimento")!.getRow(2).getCell(1).value).toBe("Segunda-feira");
    const profile: Record<string, unknown> = {};
    provider.getWorksheet("Meus dados")!.eachRow((r, i) => { if (i > 1) profile[String(r.getCell(1).value)] = r.getCell(2).value; });
    expect(profile["Situação do CREF"]).toBe("Aprovado");
    expect(profile["Especialidades"]).toBe("Hipertrofia, Funcional");
  });

  it("'Leia-me' só avisa do limite de 500 registros quando alguma lista foi cortada", async () => {
    const text = async (payload: unknown) => {
      const workbook = await load(await buildDataExportWorkbook(payload as any));
      const lines: string[] = [];
      workbook.getWorksheet("Leia-me")!.eachRow((r) => lines.push(String(r.getCell(1).value)));
      return lines.join("\n");
    };
    expect(await text(emptyPayload())).not.toContain("limite de registros");
    expect(await text(emptyPayload({ truncated: { chatMessages: true } }))).toContain("limite de registros");
  });

  it("anamnese vira pares pergunta/resposta legíveis (Sim/Não, listas)", async () => {
    const workbook = await load(await buildDataExportWorkbook(emptyPayload({
      anamnesis: { status: "COMPLETED", completedAt: null, createdAt: new Date(), answers: { personalData: { birthDate: "1990-01-01" }, healthHistory: { hasHeartCondition: false, medications: ["A", "B"] } } }
    })));
    const sheet = workbook.getWorksheet("Anamnese")!;
    const map: Record<string, unknown> = {};
    sheet.eachRow((r, i) => { if (i > 1) map[String(r.getCell(1).value)] = r.getCell(2).value; });
    expect(map["Personal data — Birth date"]).toBe("1990-01-01");
    expect(map["Health history — Has heart condition"]).toBe("Não");
    expect(map["Health history — Medications"]).toBe("A, B");
  });
});

describe("exportMyDataSpreadsheet (ponta a ponta, banco de teste)", () => {
  const userService = new UserService();
  let userId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        name: "Aluno Teste Planilha",
        email: `${uid("xlsx_export")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: UserRole.CLIENT
      }
    });
    userId = user.id;
    await prisma.supportTicket.create({ data: { userId, subject: "Assunto teste", message: "Mensagem de teste", status: "OPEN" } });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  afterAll(async () => {
    await prisma.dataExportLog.deleteMany({ where: { userId } });
    await prisma.supportTicket.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("devolve um .xlsx válido em base64 com os dados reais do usuário e registra UMA exportação", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(false);

    const file = await userService.exportMyDataSpreadsheet(userId);
    expect(file.filename).toMatch(/^muvify-meus-dados-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(file.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const workbook = await load(Buffer.from(file.base64, "base64"));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(expect.arrayContaining(["Leia-me", "Resumo", "Meus dados", "Chamados de suporte"]));
    expect(workbook.getWorksheet("Chamados de suporte")!.getRow(2).getCell(2).value).toBe("Assunto teste");
    expect(workbook.getWorksheet("Chamados de suporte")!.getRow(2).getCell(4).value).toBe("Em análise");

    expect(await prisma.dataExportLog.count({ where: { userId } })).toBe(1);
  });
});
