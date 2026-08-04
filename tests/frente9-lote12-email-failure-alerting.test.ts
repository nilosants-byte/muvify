import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @sentry/node é ESM com exports não-configuráveis - vi.spyOn direto no
// namespace do módulo falha ("Cannot redefine property"). vi.mock
// substitui o módulo inteiro antes da resolução dos imports; vi.hoisted
// garante que o mock exista antes do factory (hoisted) rodar.
const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: vi.fn()
}));

import { prisma } from "../src/config/prisma";
import { EmailQueueService } from "../src/shared/services/email-queue.service";
import { EmailService } from "../src/shared/services/email.service";

// Épico de Frentes, Frente 9, Lote 12: item da fila que esgota as 6
// tentativas ficava marcado como falho sem gerar nenhum alerta - só era
// descoberto no expurgo de 30 dias (purgeOldFailures), tarde demais pra
// ser útil. Agora dispara Sentry.captureException ao esgotar.
//
// Sem teste dedicado pro boot-check de SMTP ausente em produção
// (server.ts): esse arquivo inicia um HTTP listener real e os jobs de
// background reais no import, sem infraestrutura de teste hoje (nenhum
// outro trecho de server.ts é testado nesta suíte), e bootstrap() não é
// exportado. Refatorar isso só pra viabilizar este teste seria
// desproporcional ao tamanho da mudança (um if + um log + uma chamada ao
// Sentry).

const emailQueueService = new EmailQueueService();
const trackedQueueIds = new Set<string>();

describe("Frente 9, Lote 12 — falhas de e-mail deixam de ser silenciosas", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    captureExceptionMock.mockClear();
    const ids = Array.from(trackedQueueIds);
    trackedQueueIds.clear();
    if (ids.length > 0) {
      await prisma.emailDeliveryQueue.deleteMany({ where: { id: { in: ids } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("esgotar as 6 tentativas de um item da fila dispara Sentry.captureException", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    vi.spyOn(EmailService.prototype, "sendPasswordResetEmail").mockRejectedValue(
      new Error("smtp still offline")
    );
    const captureSpy = captureExceptionMock;

    const queued = await prisma.emailDeliveryQueue.create({
      data: {
        template: "PASSWORD_RESET",
        payload: {
          to: "queue_alert@test.com",
          name: "Queue Alert",
          resetToken: "token-alert"
        },
        attempts: 5,
        nextRetryAt: new Date(0)
      }
    });
    trackedQueueIds.add(queued.id);

    await emailQueueService.processRetryQueue();

    expect(captureSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "email-queue" }),
        extra: expect.objectContaining({ queueId: queued.id, template: "PASSWORD_RESET", attempts: 6 })
      })
    );

    const stored = await prisma.emailDeliveryQueue.findUnique({ where: { id: queued.id } });
    expect(stored?.attempts).toBe(6);
    expect(stored?.failedAt).toBeTruthy();
  });

  it("uma falha que ainda não esgotou as tentativas não dispara Sentry.captureException", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    vi.spyOn(EmailService.prototype, "sendPasswordResetEmail").mockRejectedValue(
      new Error("smtp offline")
    );
    const captureSpy = captureExceptionMock;

    const queued = await prisma.emailDeliveryQueue.create({
      data: {
        template: "PASSWORD_RESET",
        payload: {
          to: "queue_no_alert@test.com",
          name: "Queue No Alert",
          resetToken: "token-no-alert"
        },
        attempts: 0,
        nextRetryAt: new Date(0)
      }
    });
    trackedQueueIds.add(queued.id);

    await emailQueueService.processRetryQueue();

    expect(captureSpy).not.toHaveBeenCalled();

    const stored = await prisma.emailDeliveryQueue.findUnique({ where: { id: queued.id } });
    expect(stored?.attempts).toBe(1);
    expect(stored?.failedAt).toBeNull();
  });
});
