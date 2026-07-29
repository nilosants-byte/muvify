import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { escapeCsv } from "../src/shared/utils/csv";
import { AdminService } from "../src/modules/admin/services/admin.service";

// Raio-X de pagamentos, Rodada 5, Lote 6 (cobertura de testes): 2 itens de
// baixo risco sem nenhum teste — o hardening de injeção de fórmula em CSV
// (Rodada 4, Lote 13) e o ramo 404 de exportUserData/setLegalHold.

describe("escapeCsv neutraliza injeção de fórmula (Rodada 4, Lote 13)", () => {
  it("prefixa com aspa simples valores que começam com =, +, -, @", () => {
    expect(escapeCsv("=SOMA(A1:A2)")).toBe(`"'=SOMA(A1:A2)"`);
    expect(escapeCsv("+1234")).toBe(`"'+1234"`);
    expect(escapeCsv("-1234")).toBe(`"'-1234"`);
    expect(escapeCsv("@cmd")).toBe(`"'@cmd"`);
  });

  it("não mexe em valores normais, só escapa aspas duplas internas", () => {
    expect(escapeCsv("Sessão avulsa")).toBe(`"Sessão avulsa"`);
    expect(escapeCsv('Nome "apelido" completo')).toBe(`"Nome ""apelido"" completo"`);
  });
});

describe("exportUserData / setLegalHold: ramo 404 pra usuário inexistente (Rodada 4, Lote 9)", () => {
  const adminService = new AdminService();
  let adminId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const admin = await prisma.user
      .create({
        data: {
          name: "Lote6 Admin",
          email: adminEmail,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exportUserData rejeita com 404 um targetUserId inexistente", async () => {
    await expect(adminService.exportUserData(adminId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      /não encontrado/i
    );
  });

  it("setLegalHold rejeita com 404 um targetUserId inexistente", async () => {
    await expect(
      adminService.setLegalHold(
        adminId,
        "00000000-0000-0000-0000-000000000000",
        new Date(Date.now() + 86400000).toISOString(),
        "teste"
      )
    ).rejects.toThrow(/não encontrado/i);
  });
});
