import "dotenv/config";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

// @sentry/node é ESM com exports não-configuráveis - vi.spyOn direto no
// namespace do módulo falha ("Cannot redefine property"). vi.mock
// substitui o módulo inteiro antes da resolução dos imports; vi.hoisted
// garante que o mock exista antes do factory (hoisted) rodar.
const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: vi.fn()
}));

import { isolateReminderSubJob } from "../src/modules/notifications/jobs/reminder.job";

// Épico de Frentes, Frente 9, Lote 14: reminder.job.ts só usava
// console.error nos catches, sem Sentry.captureException - diferente de
// pontos críticos de pagamento que já usam Sentry deliberadamente. Cada
// sub-job passa a ser isolado (falha de um não impede os demais) e
// reporta ao Sentry com a tag indicando qual sub-job falhou.
describe("Frente 9, Lote 14 — reminder.job.ts isola sub-jobs e reporta ao Sentry", () => {
  afterEach(() => {
    captureExceptionMock.mockClear();
  });

  it("sub-job que falha (erro comum) dispara Sentry.captureException com a tag do sub-job e não propaga o erro", async () => {
    const error = new Error("falha ao enviar lembrete");
    const failingSubJob = vi.fn().mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(isolateReminderSubJob(failingSubJob, "sendSessionReminders")).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ tags: { area: "reminder-job", subJob: "sendSessionReminders" } })
    );
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("um sub-job falhando não impede outro de rodar (isolamento)", async () => {
    const failingSubJob = vi.fn().mockRejectedValue(new Error("falha"));
    const succeedingSubJob = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await Promise.all([
      isolateReminderSubJob(failingSubJob, "sendSessionReminders"),
      isolateReminderSubJob(succeedingSubJob, "sendBookingConfirmationReminders"),
    ]);

    expect(succeedingSubJob).toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ subJob: "sendSessionReminders" }) })
    );
  });

  it("erro de banco indisponível é relançado (pro backoff externo) sem chamar Sentry", async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError("db down", {
      code: "P1001",
      clientVersion: "test"
    });
    const failingSubJob = vi.fn().mockRejectedValue(dbError);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(isolateReminderSubJob(failingSubJob, "sendFichaExpiryReminders")).rejects.toBe(dbError);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
