import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 10:
// refreshProviderMpTokens lê todos os providers num findMany no início do
// job e processa em loop - se o profissional reconectar a conta bem no
// meio dessa janela (entre o findMany e a tentativa de refresh daquele
// provider específico), o job tentava usar o refresh token antigo (já
// substituído), a chamada falhava com 400/401, e o job marcava
// mpTokenInvalidatedAt de novo — reabrindo o aviso de reconexão logo
// depois de uma reconexão bem-sucedida.

const paymentService = new PaymentService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let providerUserId = "";
let providerId = "";

describe("Frente 7, Lote 10 — corrida entre reconexão do profissional e o job de refresh de token", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Dez",
        email: `${uid("f7l10_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Dez",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.$disconnect();
  });

  it("se o profissional reconectar durante a chamada de refresh, a falha do token antigo não reabre o aviso de reconexão", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccountId: "111222333",
        mpRefreshToken: encryptSensitiveText("refresh_antigo"),
        mpTokenExpiresAt: new Date(Date.now() + 1000),
        mpTokenInvalidatedAt: null
      }
    });

    vi.spyOn(global, "fetch").mockImplementationOnce(async () => {
      // Simula o profissional completando a reconexão (novo refresh token
      // gravado) exatamente durante a janela em que o job já está com o
      // token antigo em mãos, tentando renová-lo.
      await prisma.providerProfile.update({
        where: { id: providerId },
        data: { mpRefreshToken: encryptSensitiveText("refresh_novo_pos_reconexao"), mpTokenInvalidatedAt: null }
      });
      return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) } as any;
    });

    await paymentService.refreshProviderMpTokens();

    const after = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(after.mpTokenInvalidatedAt).toBeNull();
  });

  it("sem corrida (token realmente inválido, nada mudou): continua marcando mpTokenInvalidatedAt normalmente", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccountId: "111222333",
        mpRefreshToken: encryptSensitiveText("refresh_invalido_de_verdade"),
        mpTokenExpiresAt: new Date(Date.now() + 1000),
        mpTokenInvalidatedAt: null
      }
    });

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" })
    } as any);

    await paymentService.refreshProviderMpTokens();

    const after = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(after.mpTokenInvalidatedAt).not.toBeNull();
  });
});
