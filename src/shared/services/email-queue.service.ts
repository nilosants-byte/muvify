import { prisma } from "../../config/prisma";
import { EmailService } from "./email.service";

const MAX_RETRY_ATTEMPTS = 6;
// 30s -> 5min -> 30min -> 2h -> 12h -> 24h
const RETRY_DELAY_SECONDS = [30, 300, 1800, 7200, 43200, 86400];

type EmailQueueTemplate = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

type VerificationPayload = {
  to: string;
  name: string;
  verificationUrl: string;
};

type PasswordResetPayload = {
  to: string;
  name: string;
  resetToken: string;
};

export class EmailQueueService {
  private emailService = new EmailService();

  async enqueueEmailVerification(input: VerificationPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "EMAIL_VERIFICATION",
        payload: input
      }
    });
  }

  async enqueuePasswordReset(input: PasswordResetPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "PASSWORD_RESET",
        payload: input
      }
    });
  }

  async processRetryQueue(): Promise<void> {
    if (!this.emailService.canSendEmail()) {
      return;
    }

    const now = new Date();
    const pending = await prisma.emailDeliveryQueue.findMany({
      where: {
        failedAt: null,
        attempts: { lt: MAX_RETRY_ATTEMPTS },
        nextRetryAt: { lte: now }
      },
      take: 50,
      orderBy: { nextRetryAt: "asc" }
    });

    if (pending.length === 0) {
      return;
    }

    for (const entry of pending) {
      try {
        await this.deliver(entry.template as EmailQueueTemplate, entry.payload as Record<string, unknown>);
        await prisma.emailDeliveryQueue.delete({ where: { id: entry.id } });
      } catch (error) {
        const attempts = entry.attempts + 1;
        const delaySeconds =
          RETRY_DELAY_SECONDS[Math.min(attempts - 1, RETRY_DELAY_SECONDS.length - 1)] ??
          RETRY_DELAY_SECONDS[RETRY_DELAY_SECONDS.length - 1]!;
        const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
        const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);

        await prisma.emailDeliveryQueue.update({
          where: { id: entry.id },
          data: {
            attempts,
            nextRetryAt,
            lastError,
            failedAt: attempts >= MAX_RETRY_ATTEMPTS ? new Date() : null
          }
        });
      }
    }
  }

  private async deliver(template: EmailQueueTemplate, payload: Record<string, unknown>) {
    if (template === "EMAIL_VERIFICATION") {
      const parsed = this.parseVerificationPayload(payload);
      await this.emailService.sendEmailVerificationEmail(parsed);
      return;
    }
    if (template === "PASSWORD_RESET") {
      const parsed = this.parsePasswordResetPayload(payload);
      await this.emailService.sendPasswordResetEmail(parsed);
      return;
    }
    throw new Error(`Unsupported email queue template: ${template}`);
  }

  private validateEmail(email: string): void {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Invalid email format in queue payload: ${email}`);
    }
  }

  private parseVerificationPayload(payload: Record<string, unknown>): VerificationPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    const verificationUrl =
      typeof payload.verificationUrl === "string" ? payload.verificationUrl : "";
    if (!to || !name || !verificationUrl) {
      throw new Error("Invalid EMAIL_VERIFICATION payload.");
    }
    this.validateEmail(to);
    return { to, name, verificationUrl };
  }

  private parsePasswordResetPayload(payload: Record<string, unknown>): PasswordResetPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    const resetToken = typeof payload.resetToken === "string" ? payload.resetToken : "";
    if (!to || !name || !resetToken) {
      throw new Error("Invalid PASSWORD_RESET payload.");
    }
    this.validateEmail(to);
    return { to, name, resetToken };
  }

  async purgeOldFailures(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await prisma.emailDeliveryQueue.deleteMany({
      where: { failedAt: { not: null, lt: cutoff } }
    });
    return result.count;
  }
}
