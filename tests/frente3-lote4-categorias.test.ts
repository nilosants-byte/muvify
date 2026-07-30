import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { CategoryService } from "../src/modules/categories/services/category.service";

// Épico de Frentes, Frente 3 (Cadastro/onboarding), Lote 4:
// (1) criação automática de categoria via "especialidade" do provider
//     dedupla por acentuação/espaço, não só case-insensitive exato.
// (2) criação manual pelo admin também dedupla por acentuação.
// (3) categoria desativada some da listagem pública mas segue íntegra
//     pra quem já a referencia; reescrever a mesma especialidade cria uma
//     categoria nova em vez de reviver a desativada.

const categoryService = new CategoryService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const PASSWORD = "Test1234";
let adminId = "";
const userIds: string[] = [];
const categoryIds: string[] = [];

describe("Frente 3, Lote 4 — categorias de serviço", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const adminReg = await prisma.user
      .create({
        data: {
          name: "Lote4 Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}6`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.providerCategory.deleteMany({ where: { categoryId: { in: categoryIds } } });
    await prisma.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("duas especialidades com acento diferente não criam categorias duplicadas", async () => {
    const email = `${uid("dedup_prov")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Dedup Provider",
      email,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userIds.push(reg.body.user.id);
    const token = reg.body.accessToken;

    const specialtyBase = uid("Especialidade");
    const withoutAccent = `${specialtyBase} Pilates`;
    const withAccent = `${specialtyBase} Pilátes`;

    await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        displayName: "Dedup Provider",
        bio: "Bio de teste com mais de dez caracteres.",
        experienceYears: 2,
        priceCents: 10000,
        categoryIds: [],
        specialties: [withoutAccent]
      });

    const secondEmail = `${uid("dedup_prov2")}@test.com`;
    const reg2 = await request(app).post("/api/auth/register").send({
      name: "Dedup Provider Dois",
      email: secondEmail,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}2`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userIds.push(reg2.body.user.id);
    await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${reg2.body.accessToken}`)
      .send({
        displayName: "Dedup Provider Dois",
        bio: "Bio de teste com mais de dez caracteres.",
        experienceYears: 3,
        priceCents: 12000,
        categoryIds: [],
        specialties: [withAccent]
      });

    const matches = await prisma.serviceCategory.findMany({
      where: { name: { in: [withoutAccent, withAccent], mode: "insensitive" } }
    });
    matches.forEach((c) => categoryIds.push(c.id));
    expect(matches.length).toBe(1);
  });

  it("admin não consegue criar categoria com acento diferente de uma já existente", async () => {
    const name = `Dedup Manual ${uid("x")}`;
    const created = await categoryService.create(name);
    categoryIds.push(created.id);

    await expect(categoryService.create(`${name.replace("Dedup Manual", "Dédup Manual")}`)).rejects.toThrow(
      /já existe/i
    );
  });

  it("admin desativa categoria: some da listagem pública, mas continua íntegra", async () => {
    const name = `Desativar ${uid("y")}`;
    const created = await categoryService.create(name);
    categoryIds.push(created.id);

    const beforeList = await categoryService.list();
    expect((beforeList as any[]).some((c) => c.id === created.id)).toBe(true);

    const deactivated = await categoryService.deactivate(created.id);
    expect(deactivated.active).toBe(false);

    const afterList = await categoryService.list();
    expect((afterList as any[]).some((c) => c.id === created.id)).toBe(false);

    const stillExists = await prisma.serviceCategory.findUniqueOrThrow({ where: { id: created.id } });
    expect(stillExists.id).toBe(created.id);
  });

  it("admin reativa categoria e ela volta a aparecer na listagem", async () => {
    const name = `Reativar ${uid("z")}`;
    const created = await categoryService.create(name);
    categoryIds.push(created.id);
    await categoryService.deactivate(created.id);

    const reactivated = await categoryService.reactivate(created.id);
    expect(reactivated.active).toBe(true);

    const list = await categoryService.list();
    expect((list as any[]).some((c) => c.id === created.id)).toBe(true);
  });

  it("reescrever a mesma especialidade de uma categoria desativada vincula à categoria existente, sem tentar criar duplicata", async () => {
    // O nome tem constraint única no banco independente de `active` -
    // "criar uma categoria nova" com o mesmo nome de uma desativada sempre
    // colidiria. O comportamento correto é vincular à categoria existente
    // (que continua desativada, fora da busca pública) em vez de tentar
    // (e falhar silenciosamente por skipDuplicates) criar uma segunda linha
    // com o mesmo nome.
    const specialtyName = `Revive ${uid("w")}`;
    const original = await categoryService.create(specialtyName);
    categoryIds.push(original.id);
    await categoryService.deactivate(original.id);

    const email = `${uid("revive_prov")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Revive Provider",
      email,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}3`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userIds.push(reg.body.user.id);
    const profileRes = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${reg.body.accessToken}`)
      .send({
        displayName: "Revive Provider",
        bio: "Bio de teste com mais de dez caracteres.",
        experienceYears: 2,
        priceCents: 10000,
        categoryIds: [],
        specialties: [specialtyName]
      });
    expect(profileRes.status).toBe(201);

    const matches = await prisma.serviceCategory.findMany({
      where: { name: { equals: specialtyName, mode: "insensitive" } }
    });
    matches.forEach((c) => categoryIds.push(c.id));
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe(original.id);
    expect(matches[0].active).toBe(false);

    const link = await prisma.providerCategory.findFirst({ where: { categoryId: original.id } });
    expect(link).not.toBeNull();
  });

  it("bloqueia deactivate/reactivate pra quem não é admin (403)", async () => {
    const email = `${uid("notadmin")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Nao Admin",
      email,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}4`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userIds.push(reg.body.user.id);

    const name = `Protegida ${uid("p")}`;
    const created = await categoryService.create(name);
    categoryIds.push(created.id);

    const res = await request(app)
      .patch(`/api/categories/${created.id}/deactivate`)
      .set("Authorization", `Bearer ${reg.body.accessToken}`);
    expect(res.status).toBe(403);
  });
});
