import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ExerciseService } from "../src/modules/exercises/services/exercise.service";
import { CategoryService } from "../src/modules/categories/services/category.service";

// Épico de Frentes, Frente 10, Lote 7: baixo risco - revalidação,
// documentação, limite de caracteres, polish final.
// (1) exercise.service.ts (createPrebuilt/updatePrebuilt/deletePrebuilt) e
//     category.service.ts (create/deactivate/reactivate) recebiam adminId
//     só pro audit log, nunca revalidavam isAdminEmail no banco (defesa em
//     profundidade) - dependiam 100% do ensureRole(ADMIN) da rota.
// (2) categoria não gravava audit log nenhum.
// (3) adminResponse de ticket limitado a 300 caracteres, curto pra
//     instruções passo a passo - migrou pra 2000.

const exerciseService = new ExerciseService();
const categoryService = new CategoryService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let adminId = "";
let adminToken = "";
let nonAdminId = "";
const createdUserIds: string[] = [];
const createdExerciseIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdTicketIds: string[] = [];

describe("Frente 10, Lote 7 — revalidação, documentação, limite de caracteres", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Sete Admin",
      email: adminEmail,
      password: PASSWORD,
      phone: `1177${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
    const adminLogin = await request(app).post("/api/auth/login").send({ email: adminEmail, password: PASSWORD });
    adminToken = adminLogin.body.accessToken;

    const nonAdmin = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Sete Nao Admin",
        email: uniqueEmail("f10l7_nonadmin"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    nonAdminId = nonAdmin.id;
    createdUserIds.push(nonAdminId);
  });

  afterAll(async () => {
    await prisma.exercise.deleteMany({ where: { id: { in: createdExerciseIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
    await prisma.supportTicket.deleteMany({ where: { id: { in: createdTicketIds } } });
    // Frente 12 (segunda camada), Lote 4: NÃO apaga AdminAuditLog daqui —
    // adminId é a conta fixa compartilhada com dezenas de outros arquivos
    // rodando em paralelo; apagar aqui podia derrubar a asserção de outro
    // arquivo concorrente que ainda não tinha lido o próprio registro
    // (mesma classe de risco já reconhecida pra não apagar a conta admin
    // em si). AdminAuditLog é trilha de auditoria — crescimento no banco
    // de teste é aceitável, mesmo raciocínio já usado pra produção.
    await prisma.session.deleteMany({ where: { userId: { in: [...createdUserIds, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("e-mail fora do allowlist não consegue mais criar/editar/apagar exercício pré-montado, mesmo com adminId em mãos", async () => {
    await expect(
      exerciseService.createPrebuilt(nonAdminId, { name: "Exercício forjado", category: "Teste" })
    ).rejects.toThrow("Acesso negado.");

    // cria de verdade como admin de fato, pra testar update/delete
    const real = await exerciseService.createPrebuilt(adminId, { name: `Exercício ${uid("real")}`, category: "Teste" });
    createdExerciseIds.push(real.id);

    await expect(
      exerciseService.updatePrebuilt(nonAdminId, real.id, { name: "Editado por não-admin" })
    ).rejects.toThrow("Acesso negado.");

    await expect(exerciseService.deletePrebuilt(nonAdminId, real.id)).rejects.toThrow("Acesso negado.");
  });

  it("e-mail fora do allowlist não consegue mais criar/desativar/reativar categoria, e ação de categoria grava audit log", async () => {
    await expect(categoryService.create(nonAdminId, `Categoria forjada ${uid("cat")}`)).rejects.toThrow(
      "Acesso negado."
    );

    const real = await categoryService.create(adminId, `Categoria real ${uid("cat")}`);
    createdCategoryIds.push(real.id);

    await expect(categoryService.deactivate(nonAdminId, real.id)).rejects.toThrow("Acesso negado.");

    await categoryService.deactivate(adminId, real.id);
    await categoryService.reactivate(adminId, real.id);

    // Frente 12 (segunda camada), Lote 1: writeAdminAuditLog agora é
    // aguardado (await) dentro do service antes de deactivate/reactivate
    // retornarem — não é mais fire-and-forget. Poll com retry curto mantido
    // como defesa em profundidade, não porque a escrita ainda seja
    // assíncrona sem espera. (Esta era a causa raiz real do que tinha sido
    // documentado antes como "bug pré-existente de auditoria de categoria"
    // — não era determinístico, era a mesma race de escrita fire-and-forget
    // de todo o resto desta frente.)
    let auditLog = null;
    for (let attempt = 0; attempt < 5 && !auditLog; attempt++) {
      auditLog = await prisma.adminAuditLog.findFirst({
        where: { targetId: real.id, action: "CATEGORY_DEACTIVATED" }
      });
      if (!auditLog) await sleep(150);
    }
    expect(auditLog).not.toBeNull();

    let reactivateLog = null;
    for (let attempt = 0; attempt < 5 && !reactivateLog; attempt++) {
      reactivateLog = await prisma.adminAuditLog.findFirst({
        where: { targetId: real.id, action: "CATEGORY_REACTIVATED" }
      });
      if (!reactivateLog) await sleep(150);
    }
    expect(reactivateLog).not.toBeNull();

    const createLog = await prisma.adminAuditLog.findFirst({
      where: { targetId: real.id, action: "CATEGORY_CREATED" }
    });
    expect(createLog).not.toBeNull();
  });

  it("resposta de suporte com mais de 300 (até 2000) caracteres é aceita", async () => {
    const userRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Sete Ticket User",
      email: uniqueEmail("f10l7_ticketuser"),
      password: PASSWORD,
      phone: `1188${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    createdUserIds.push(userRegister.body.user.id);

    const create = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userRegister.body.accessToken}`)
      .send({ subject: "Assunto longo", message: "Preciso de uma explicação bem detalhada." });
    const ticketId = create.body.ticketId as string;
    createdTicketIds.push(ticketId);

    const longResponse = "x".repeat(1500);
    const reply = await request(app)
      .patch(`/api/admin/support/tickets/${ticketId}/respond`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ responseMessage: longResponse });
    expect(reply.status).toBe(200);

    const stored = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(stored.adminResponse).toBe(longResponse);
    expect(stored.adminResponse!.length).toBe(1500);
  });
});
