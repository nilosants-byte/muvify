import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { EmailQueueService } from "../src/shared/services/email-queue.service";
import { EmailService } from "../src/shared/services/email.service";

const emailQueueService = new EmailQueueService();
const trackedQueueIds = new Set<string>();

describe("email-queue", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const ids = Array.from(trackedQueueIds);
    trackedQueueIds.clear();
    if (ids.length > 0) {
      await prisma.emailDeliveryQueue.deleteMany({ where: { id: { in: ids } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("enfileira e processa e-mail de verificacao com sucesso", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    const sendVerificationSpy = vi
      .spyOn(EmailService.prototype, "sendEmailVerificationEmail")
      .mockResolvedValue();

    const queued = await emailQueueService.enqueueEmailVerification({
      to: "queue_verify@test.com",
      name: "Queue Verify",
      verificationUrl: "https://muvify.test/verify?token=abc"
    });
    trackedQueueIds.add(queued.id);

    await emailQueueService.processRetryQueue();

    const stored = await prisma.emailDeliveryQueue.findUnique({
      where: { id: queued.id },
      select: { id: true }
    });

    expect(sendVerificationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: "queue_verify@test.com" })
    );
    expect(stored).toBeNull();
  });

  it("incrementa tentativa e agenda novo retry quando envio falha", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    vi.spyOn(EmailService.prototype, "sendPasswordResetEmail").mockRejectedValue(
      new Error("smtp offline")
    );

    const queued = await emailQueueService.enqueuePasswordReset({
      to: "queue_retry@test.com",
      name: "Queue Retry",
      resetToken: "token-123"
    });
    trackedQueueIds.add(queued.id);

    const before = Date.now();
    await emailQueueService.processRetryQueue();

    const stored = await prisma.emailDeliveryQueue.findUnique({
      where: { id: queued.id },
      select: {
        attempts: true,
        failedAt: true,
        lastError: true,
        nextRetryAt: true
      }
    });

    expect(stored?.attempts).toBe(1);
    expect(stored?.failedAt).toBeNull();
    expect(stored?.lastError).toContain("smtp offline");
    expect((stored?.nextRetryAt.getTime() ?? 0) > before).toBe(true);
  });

  it("marca como falha definitiva apos atingir limite maximo", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    vi.spyOn(EmailService.prototype, "sendPasswordResetEmail").mockRejectedValue(
      new Error("smtp still offline")
    );

    const queued = await prisma.emailDeliveryQueue.create({
      data: {
        template: "PASSWORD_RESET",
        payload: {
          to: "queue_fail@test.com",
          name: "Queue Fail",
          resetToken: "token-456"
        },
        attempts: 5,
        nextRetryAt: new Date(Date.now() - 1_000)
      }
    });
    trackedQueueIds.add(queued.id);

    await emailQueueService.processRetryQueue();

    const stored = await prisma.emailDeliveryQueue.findUnique({
      where: { id: queued.id },
      select: {
        attempts: true,
        failedAt: true,
        lastError: true
      }
    });

    expect(stored?.attempts).toBe(6);
    expect(stored?.failedAt).toBeTruthy();
    expect(stored?.lastError).toContain("smtp still offline");
  });
});
