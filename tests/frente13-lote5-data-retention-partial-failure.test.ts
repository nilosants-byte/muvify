import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @sentry/node é ESM com exports não-configuráveis - vi.mock + vi.hoisted,
// mesmo padrão de tests/frente9-lote12-email-failure-alerting.test.ts.
const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn()
}));

import { prisma } from "../src/config/prisma";
import { DataRetentionService } from "../src/modules/privacy/services/data-retention.service";

// Frente 13 (segunda camada), Lote 5: uma regra de retenção que falhava
// (Promise.all + filter(Boolean) descartando o `null`) nunca aparecia em
// lugar nenhum — o DataRetentionExecutionLog gravava status "SUCCESS"
// hardcoded mesmo assim. Risco de compliance real (LGPD): se
// cleanupAnamnesis (dado de saúde) falhasse toda vez, ninguém saberia.

const dataRetentionService = new DataRetentionService();
const createdLogIds: string[] = [];

describe("Frente 13, Lote 5 — regra de retenção que falha não fica mascarada como sucesso", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    captureExceptionMock.mockClear();
  });

  afterAll(async () => {
    await prisma.dataRetentionExecutionLog.deleteMany({ where: { id: { in: createdLogIds } } });
    await prisma.$disconnect();
  });

  it("execução sem nenhuma falha continua SUCCESS, com failedRuleIds vazio", async () => {
    const result = await dataRetentionService.run({ dryRun: true, triggeredBy: "frente13-lote5-test" });

    expect(result.status).toBe("SUCCESS");
    expect(result.failedRuleIds).toEqual([]);
    expect(result.totals.failedRules).toBe(0);
    expect(captureExceptionMock).not.toHaveBeenCalled();

    const logRow = await prisma.dataRetentionExecutionLog.findFirst({
      where: { triggeredBy: "frente13-lote5-test" },
      orderBy: { createdAt: "desc" }
    });
    expect(logRow).not.toBeNull();
    if (logRow) createdLogIds.push(logRow.id);
    expect(logRow?.status).toBe("SUCCESS");
  });

  // Roda por último, de propósito: prisma.session é um Proxy interno do
  // Prisma Client, e vi.spyOn/mockRestore nele não restaura a implementação
  // original de forma confiável entre testes (confirmado empiricamente —
  // um teste "sem falha" rodando DEPOIS deste via vi.restoreAllMocks
  // recebia "prisma.session.count is not a function"). Isolar o mock no
  // último teste do arquivo evita depender dessa restauração.
  it("regra que lança exceção vira PARTIAL_FAILURE, aparece em failedRuleIds e chama Sentry.captureException", async () => {
    vi.spyOn(prisma.session, "count").mockRejectedValueOnce(new Error("falha simulada na regra de sessões"));

    const result = await dataRetentionService.run({ dryRun: true, triggeredBy: "frente13-lote5-test" });

    expect(result.status).toBe("PARTIAL_FAILURE");
    expect(result.failedRuleIds).toContain("sessions_expired_or_revoked");
    expect(result.totals.failedRules).toBe(1);
    // As outras 20 regras continuam rodando normalmente mesmo com uma falhando.
    expect(result.totals.rules).toBe(20);

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "falha simulada na regra de sessões" }),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "data-retention", ruleId: "sessions_expired_or_revoked" })
      })
    );

    const logRow = await prisma.dataRetentionExecutionLog.findFirst({
      where: { triggeredBy: "frente13-lote5-test" },
      orderBy: { createdAt: "desc" }
    });
    expect(logRow).not.toBeNull();
    if (logRow) createdLogIds.push(logRow.id);
    expect(logRow?.status).toBe("PARTIAL_FAILURE");
  });
});
