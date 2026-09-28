import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { hashValue } from "../src/shared/utils/hash";

// Achado em teste manual (2026-09-28): a senha era conferida só DEPOIS da
// consulta pesada de exportMyData (dezenas de tabelas) já ter rodado - errar
// a senha esperava o mesmo tempo de uma exportação de verdade antes de
// avisar o erro. A senha agora é conferida com uma consulta mínima, ANTES da
// consulta pesada - este teste prova isso indiretamente: se a senha estiver
// errada, nenhum DataExportLog é criado (esse registro só é gravado no fim
// do caminho pesado, então sua ausência comprova que ele nunca rodou).

const PASSWORD = "Test1234";
const userService = new UserService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let userId = "";

describe("exportMyData — senha conferida antes da consulta pesada", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        name: "Teste Senha Export",
        email: `${uid("export_pw_gate")}@test.com`,
        password: await hashValue(PASSWORD),
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: UserRole.CLIENT
      }
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.dataExportLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("senha errada rejeita sem rodar a consulta pesada (nenhum DataExportLog é criado)", async () => {
    await expect(userService.exportMyData(userId, "SenhaErrada")).rejects.toMatchObject({ statusCode: 401 });
    const logs = await prisma.dataExportLog.findMany({ where: { userId } });
    expect(logs).toHaveLength(0);
  });

  it("senha correta segue em frente e registra a exportação", async () => {
    const result = await userService.exportMyData(userId, PASSWORD);
    expect(result.profile.id).toBe(userId);
    const logs = await prisma.dataExportLog.findMany({ where: { userId } });
    expect(logs).toHaveLength(1);
  });

  it("sem senha (caminho do admin) não exige confirmação e também registra a exportação", async () => {
    const result = await userService.exportMyData(userId);
    expect(result.profile.id).toBe(userId);
    const logs = await prisma.dataExportLog.findMany({ where: { userId } });
    expect(logs).toHaveLength(2);
  });
});
