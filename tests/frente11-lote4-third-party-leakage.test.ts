import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { sentryBeforeSend } from "../src/config/sentry";

// Épico de Frentes, Frente 11, Lote 4: terceiros e vazamento.
// (1) CPF/CNPJ digitado pelo admin numa busca ia inteiro, em texto puro,
//     pro log de auditoria (console.info) - a resposta já mascarava, o log
//     não.
// (2) Sentry.Handlers.requestHandler() sem opções captura o corpo da
//     requisição por padrão - a política afirma o contrário.

const adminService = new AdminService();

describe("Frente 11, Lote 4 — CPF mascarado no log de auditoria administrativo", () => {
  let adminId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0]!;
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      adminId = existing.id;
    } else {
      const admin = await prisma.user.create({
        data: {
          name: "Frente Onze Lote Quatro Admin",
          email: adminEmail,
          password: "x",
          phone: `1177${Date.now().toString().slice(-8)}`,
          role: "ADMIN",
          emailVerifiedAt: new Date()
        }
      });
      adminId = admin.id;
    }
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lookupCrefByDocument mascara o CPF no log, nunca loga em texto puro", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await adminService.lookupCrefByDocument(adminId, "123.456.789-00");
    const logged = infoSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    infoSpy.mockRestore();

    expect(logged).toContain("***.***.***-00");
    expect(logged).not.toContain("12345678900");
    expect(logged).not.toContain("123.456.789-00");
  });

  it("lookupChatsByDocuments mascara os dois CPFs no log", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await adminService.lookupChatsByDocuments(adminId, "11122233344", "55566677788").catch(() => undefined);
    const logged = infoSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    infoSpy.mockRestore();

    expect(logged).toContain("***.***.***-44");
    expect(logged).toContain("***.***.***-88");
    expect(logged).not.toContain("11122233344");
    expect(logged).not.toContain("55566677788");
  });

  it("lookupBookingsByDocuments mascara os dois CPFs no log", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await adminService.lookupBookingsByDocuments(adminId, "99988877766", "44433322211").catch(() => undefined);
    const logged = infoSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    infoSpy.mockRestore();

    expect(logged).toContain("***.***.***-66");
    expect(logged).toContain("***.***.***-11");
    expect(logged).not.toContain("99988877766");
    expect(logged).not.toContain("44433322211");
  });
});

describe("Frente 11, Lote 4 — sentryBeforeSend remove dados sensíveis do evento", () => {
  it("remove request.data, request.cookies, headers de auth e dados de usuário", () => {
    const event = {
      request: {
        data: { password: "segredo123", answers: { doencas: "cardiaca" } },
        cookies: { session: "abc123" },
        headers: {
          authorization: "Bearer xyz",
          cookie: "session=abc",
          "user-agent": "vitest"
        }
      },
      user: { id: "u1", email: "user@test.com", ip_address: "1.2.3.4" }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = sentryBeforeSend(event);

    expect(result.request?.data).toBeUndefined();
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.headers).not.toHaveProperty("authorization");
    expect(result.request?.headers).not.toHaveProperty("cookie");
    expect(result.request?.headers).toHaveProperty("user-agent");
    expect(result.user?.email).toBeUndefined();
    expect(result.user?.ip_address).toBeUndefined();
    expect(result.user?.id).toBe("u1");
  });
});
