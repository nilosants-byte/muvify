import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const PASSWORD = "Test1234";
let providerToken = "";
let providerUserId = "";
let providerId = "";          // ProviderProfile.id
let categoryId = "";
let studentId = "";
let incomeId = "";
let expenseId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("financial", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `FinCat_${Date.now()}`, description: "test" },
    });
    categoryId = category.id;

    const email = `${uid("fin_prov")}@test.com`;
    const phone = `119${Date.now().toString().slice(-9)}`;

    const reg = await request(app).post("/api/auth/register").send({
      name: "Financial Provider",
      email,
      password: PASSWORD,
      phone,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    providerToken = reg.body.accessToken;
    providerUserId = reg.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "Financial Provider",
        bio: "Test bio for financial tests",
        experienceYears: 2,
        priceCents: 10000,
        categoryIds: [categoryId],
      });
    providerId = profile.body.id;
  });

  afterAll(async () => {
    await prisma.financialIncome.deleteMany({ where: { providerId } });
    await prisma.financialExpense.deleteMany({ where: { providerId } });
    await prisma.financialGoal.deleteMany({ where: { providerId } });
    await prisma.financialStudent.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────
  it("GET /financial/dashboard returns 200", async () => {
    const res = await request(app)
      .get("/api/financial/dashboard")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
  });

  it("GET /financial/dashboard rejects unauthenticated", async () => {
    const res = await request(app).get("/api/financial/dashboard");
    expect(res.status).toBe(401);
  });

  it("GET /financial/report returns 200", async () => {
    const res = await request(app)
      .get("/api/financial/report")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
  });

  // ── Students ─────────────────────────────────────────────────────────────
  it("POST /financial/students creates student", async () => {
    const res = await request(app)
      .post("/api/financial/students")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ name: "Test Student", monthlyValueCents: 20000, type: "PRESENTIAL", weeklyFrequency: 3 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    studentId = res.body.id;
  });

  it("POST /financial/students rejects missing required fields", async () => {
    const res = await request(app)
      .post("/api/financial/students")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ name: "Incomplete" }); // missing monthlyValueCents and type
    expect(res.status).toBe(400);
  });

  it("GET /financial/students returns list", async () => {
    const res = await request(app)
      .get("/api/financial/students")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((s: { id: string }) => s.id === studentId)).toBe(true);
  });

  it("PATCH /financial/students/:id updates student", async () => {
    const res = await request(app)
      .patch(`/api/financial/students/${studentId}`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ name: "Updated Student", weeklyFrequency: 4 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Student");
  });

  // ── Incomes ───────────────────────────────────────────────────────────────
  it("POST /financial/incomes creates income", async () => {
    const res = await request(app)
      .post("/api/financial/incomes")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ description: "Mensalidade Janeiro", amountCents: 20000, studentId, paidAt: new Date().toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    incomeId = res.body.id;
  });

  it("POST /financial/incomes rejects zero amount", async () => {
    const res = await request(app)
      .post("/api/financial/incomes")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ description: "Zero", amountCents: 0, paidAt: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it("GET /financial/incomes returns list", async () => {
    const res = await request(app)
      .get("/api/financial/incomes")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
  });

  it("PATCH /financial/incomes/:id updates income", async () => {
    const res = await request(app)
      .patch(`/api/financial/incomes/${incomeId}`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ description: "Mensalidade Atualizada", amountCents: 22000 });
    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(22000);
  });

  // ── Expenses ──────────────────────────────────────────────────────────────
  it("POST /financial/expenses creates expense", async () => {
    const res = await request(app)
      .post("/api/financial/expenses")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ description: "Mensalidade academia", amountCents: 15000, category: "GYM", paidAt: new Date().toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expenseId = res.body.id;
  });

  it("POST /financial/expenses rejects zero amount", async () => {
    const res = await request(app)
      .post("/api/financial/expenses")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ description: "Zero", amountCents: 0, paidAt: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it("GET /financial/expenses returns list", async () => {
    const res = await request(app)
      .get("/api/financial/expenses")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
  });

  it("PATCH /financial/expenses/:id updates expense", async () => {
    const res = await request(app)
      .patch(`/api/financial/expenses/${expenseId}`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ amountCents: 16000 });
    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(16000);
  });

  // ── Goals ─────────────────────────────────────────────────────────────────
  it("PUT /financial/goals sets goal", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const res = await request(app)
      .put("/api/financial/goals")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ month, targetRevenueCents: 500000, targetStudents: 20, targetWeeklyClasses: 40 });
    expect(res.status).toBe(200);
  });

  it("GET /financial/goals returns goal", async () => {
    const res = await request(app)
      .get("/api/financial/goals")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
  });

  // ── Deletions ─────────────────────────────────────────────────────────────
  it("DELETE /financial/incomes/:id removes income", async () => {
    const res = await request(app)
      .delete(`/api/financial/incomes/${incomeId}`)
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(204);
  });

  it("DELETE /financial/expenses/:id removes expense", async () => {
    const res = await request(app)
      .delete(`/api/financial/expenses/${expenseId}`)
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(204);
  });

  it("DELETE /financial/students/:id removes student", async () => {
    const res = await request(app)
      .delete(`/api/financial/students/${studentId}`)
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(204);
  });

  // ── Recorrência ───────────────────────────────────────────────────────────
  describe("recurrence", () => {
    let recStudentId = "";
    let recIncomeId = "";
    let currentMonth = "";
    let nextMonth = "";

    beforeAll(() => {
      const now = new Date();
      currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    });

    afterAll(async () => {
      if (recIncomeId) await prisma.financialIncome.deleteMany({ where: { id: recIncomeId } });
      if (recStudentId) await prisma.financialStudent.deleteMany({ where: { id: recStudentId } });
    });

    it("aluno recorrente (padrão) fica billableThisMonth=true; aluno avulso só no próprio mês", async () => {
      const created = await request(app)
        .post("/api/financial/students")
        .set("Authorization", `Bearer ${providerToken}`)
        .send({ name: `Rec Student ${uid("s")}`, monthlyValueCents: 30000, type: "PRESENTIAL" });
      expect(created.status).toBe(201);
      expect(created.body.recurrence).toBe("RECURRING");
      recStudentId = created.body.id;

      const oneTime = await request(app)
        .post("/api/financial/students")
        .set("Authorization", `Bearer ${providerToken}`)
        .send({ name: `Avulso ${uid("s")}`, monthlyValueCents: 15000, type: "PRESENTIAL", recurrence: "ONE_TIME" });
      expect(oneTime.status).toBe(201);

      const list = await request(app)
        .get("/api/financial/students")
        .set("Authorization", `Bearer ${providerToken}`);
      expect(list.status).toBe(200);
      const recurring = list.body.find((s: { id: string }) => s.id === recStudentId);
      const avulso = list.body.find((s: { id: string }) => s.id === oneTime.body.id);
      expect(recurring.billableThisMonth).toBe(true);
      expect(avulso.billableThisMonth).toBe(true); // criado neste mês

      await prisma.financialStudent.deleteMany({ where: { id: oneTime.body.id } });
    });

    it("receita recorrente criada este mês aparece só como real (não duplica) e projeta no mês seguinte", async () => {
      const created = await request(app)
        .post("/api/financial/incomes")
        .set("Authorization", `Bearer ${providerToken}`)
        .send({
          description: "Aluguel de sala",
          amountCents: 40000,
          paidAt: new Date().toISOString(),
          recurrence: "RECURRING"
        });
      expect(created.status).toBe(201);
      expect(created.body.recurrence).toBe("RECURRING");
      recIncomeId = created.body.id;

      const thisMonthList = await request(app)
        .get(`/api/financial/incomes?month=${currentMonth}`)
        .set("Authorization", `Bearer ${providerToken}`);
      const thisMonthEntry = thisMonthList.body.find((i: { id: string }) => i.id === recIncomeId);
      expect(thisMonthEntry).toBeTruthy();
      expect(thisMonthEntry.isVirtual).toBe(false);

      const nextMonthList = await request(app)
        .get(`/api/financial/incomes?month=${nextMonth}`)
        .set("Authorization", `Bearer ${providerToken}`);
      const nextMonthEntry = nextMonthList.body.find((i: { id: string }) => i.id === recIncomeId);
      expect(nextMonthEntry).toBeTruthy();
      expect(nextMonthEntry.isVirtual).toBe(true);
      expect(nextMonthEntry.amountCents).toBe(40000);
    });

    it("editar a projeção de um mês futuro não altera o valor já registrado em meses anteriores", async () => {
      const created = await request(app)
        .post("/api/financial/incomes")
        .set("Authorization", `Bearer ${providerToken}`)
        .send({
          description: "Aluguel de sala (split)",
          amountCents: 50000,
          paidAt: new Date().toISOString(),
          recurrence: "RECURRING"
        });
      expect(created.status).toBe(201);
      const seriesId = created.body.id;

      // Edita a projeção do mês seguinte, dizendo ao backend qual mês está
      // sendo editado (occurrenceMonth) — isso deve "dividir a série".
      const patch = await request(app)
        .patch(`/api/financial/incomes/${seriesId}`)
        .set("Authorization", `Bearer ${providerToken}`)
        .send({ amountCents: 90000, occurrenceMonth: nextMonth });
      expect(patch.status).toBe(200);
      const newSeriesId = patch.body.id;
      expect(newSeriesId).not.toBe(seriesId); // criou uma nova linha, não sobrescreveu a original

      const thisMonthList = await request(app)
        .get(`/api/financial/incomes?month=${currentMonth}`)
        .set("Authorization", `Bearer ${providerToken}`);
      const originalStillThere = thisMonthList.body.find((i: { id: string }) => i.id === seriesId);
      expect(originalStillThere).toBeTruthy();
      expect(originalStillThere.amountCents).toBe(50000); // valor histórico preservado

      const nextMonthList = await request(app)
        .get(`/api/financial/incomes?month=${nextMonth}`)
        .set("Authorization", `Bearer ${providerToken}`);
      const updatedEntry = nextMonthList.body.find((i: { id: string }) => i.id === newSeriesId);
      expect(updatedEntry).toBeTruthy();
      expect(updatedEntry.amountCents).toBe(90000);

      await prisma.financialIncome.deleteMany({ where: { id: { in: [seriesId, newSeriesId] } } });
    });

    it("PATCH recurrenceEndDate na receita interrompe a projeção futura", async () => {
      const { from } = { from: new Date() }; // mês atual, para encerrar antes do próximo mês
      const endOfThisMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59);
      const patch = await request(app)
        .patch(`/api/financial/incomes/${recIncomeId}`)
        .set("Authorization", `Bearer ${providerToken}`)
        .send({ recurrenceEndDate: endOfThisMonth.toISOString() });
      expect(patch.status).toBe(200);

      const nextMonthList = await request(app)
        .get(`/api/financial/incomes?month=${nextMonth}`)
        .set("Authorization", `Bearer ${providerToken}`);
      const stillThere = nextMonthList.body.find((i: { id: string }) => i.id === recIncomeId);
      expect(stillThere).toBeFalsy();
    });
  });

  // ── Role guard ────────────────────────────────────────────────────────────
  it("GET /financial/dashboard rejects CLIENT role", async () => {
    const email = `${uid("fin_client")}@test.com`;
    const phone = `118${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Client User",
      email,
      password: PASSWORD,
      phone,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    const clientToken = reg.body.accessToken;
    const clientId = reg.body.user.id;

    const res = await request(app)
      .get("/api/financial/dashboard")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(403);

    await prisma.session.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
  });
});
