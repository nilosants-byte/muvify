import * as Sentry from "@sentry/node";
import { prisma } from "../../config/prisma";
import { EmailService } from "./email.service";

const MAX_RETRY_ATTEMPTS = 6;
// 30s -> 5min -> 30min -> 2h -> 12h -> 24h
const RETRY_DELAY_SECONDS = [30, 300, 1800, 7200, 43200, 86400];

// Épico de Frentes, Frente 9, Lote 11: PASSWORD_CHANGED/RECOVERY_EMAIL_UPDATED
// avisam sobre uma troca de credencial de segurança - se o SMTP cair
// justamente nesse instante (ex: troca de senha indevida por invasor), a
// vítima nunca era avisada por nenhum canal, já que o envio era síncrono
// sem retry. Passam a usar a mesma fila já usada por EMAIL_VERIFICATION/
// PASSWORD_RESET.
// Frente 2 (segunda camada), Lote 9: SUPPORT_REPLY/BOOKING_CONFIRMATION_*
// entraram na fila pelo mesmo motivo do Lote 11 acima — eram enviados
// direto (fire-and-forget ou síncrono), fora da fila com retry automático,
// e um deles (confirmação de agendamento) nem logava a falha.
type EmailQueueTemplate =
  | "EMAIL_VERIFICATION"
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGED"
  | "RECOVERY_EMAIL_UPDATED"
  | "DATA_EXPORT_CONFIRMATION"
  | "ACCOUNT_DELETED"
  | "SUPPORT_REPLY"
  | "BOOKING_CONFIRMATION_CLIENT"
  | "BOOKING_CONFIRMATION_PROVIDER"
  // Frente 9 (segunda camada), Lote 9: pacote presencial e consultoria
  // nunca mandavam e-mail de confirmação de compra - só booking avulso
  // (BOOKING_CONFIRMATION_*) tinha isso. Template genérico (não amarrado a
  // "sessão" como o de booking) reaproveitado pelos dois fluxos.
  | "PURCHASE_CONFIRMATION_CLIENT"
  | "PURCHASE_CONFIRMATION_PROVIDER"
  // Lista de espera pré-lançamento (landing page pública) - confirmação
  // única de "você entrou na lista", não recorrente, por isso não exige
  // opt-out (ver comentário em email.service.ts sobre a invariante).
  | "WAITLIST_WELCOME"
  // Bloco 2 (aluno externo): convite que o profissional gera pra um aluno
  // que já era dele fora do app - só entra na fila quando o profissional
  // escolhe o canal EMAIL (WhatsApp é compartilhamento local, não passa
  // pelo servidor - ver plano do bloco).
  | "EXTERNAL_STUDENT_INVITE";

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

type PasswordChangedPayload = {
  to: string;
  name: string;
};

type RecoveryEmailUpdatedPayload = {
  to: string;
  name: string;
  recoveryEmail: string;
};

type DataExportConfirmationPayload = {
  to: string;
  name: string;
};

type ExternalStudentInvitePayload = {
  to: string;
  studentName: string;
  providerName: string;
  inviteToken: string;
  expiresDays: number;
};

type AccountDeletedPayload = {
  to: string;
  name: string;
};

type SupportReplyPayload = {
  to: string;
  userName: string;
  subject?: string | null;
  responseMessage: string;
};

// scheduledAt vai como string ISO no payload (JSON não guarda Date nativo) e
// é convertido de volta em Date na hora de entregar.
type BookingConfirmationClientPayload = {
  to: string;
  clientName: string;
  providerName: string;
  scheduledAtIso: string;
  categoryName: string;
  priceCents: number;
};

type BookingConfirmationProviderPayload = {
  to: string;
  providerName: string;
  clientName: string;
  scheduledAtIso: string;
  categoryName: string;
  priceCents: number;
};

type PurchaseConfirmationClientPayload = {
  to: string;
  clientName: string;
  providerName: string;
  serviceName: string;
  priceCents: number;
};

type PurchaseConfirmationProviderPayload = {
  to: string;
  providerName: string;
  clientName: string;
  serviceName: string;
  priceCents: number;
};

type WaitlistWelcomePayload = {
  to: string;
  audience: "CLIENT" | "PROFESSIONAL";
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

  async enqueueExternalStudentInvite(input: ExternalStudentInvitePayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "EXTERNAL_STUDENT_INVITE",
        payload: input
      }
    });
  }

  async enqueuePasswordChanged(input: PasswordChangedPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "PASSWORD_CHANGED",
        payload: input
      }
    });
  }

  async enqueueRecoveryEmailUpdated(input: RecoveryEmailUpdatedPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "RECOVERY_EMAIL_UPDATED",
        payload: input
      }
    });
  }

  async enqueueDataExportConfirmation(input: DataExportConfirmationPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "DATA_EXPORT_CONFIRMATION",
        payload: input
      }
    });
  }

  async enqueueAccountDeleted(input: AccountDeletedPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "ACCOUNT_DELETED",
        payload: input
      }
    });
  }

  async enqueueSupportReply(input: SupportReplyPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "SUPPORT_REPLY",
        payload: input
      }
    });
  }

  async enqueueBookingConfirmationClient(input: Omit<BookingConfirmationClientPayload, "scheduledAtIso"> & { scheduledAt: Date }) {
    const { scheduledAt, ...rest } = input;
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "BOOKING_CONFIRMATION_CLIENT",
        payload: { ...rest, scheduledAtIso: scheduledAt.toISOString() }
      }
    });
  }

  async enqueueBookingConfirmationProvider(input: Omit<BookingConfirmationProviderPayload, "scheduledAtIso"> & { scheduledAt: Date }) {
    const { scheduledAt, ...rest } = input;
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "BOOKING_CONFIRMATION_PROVIDER",
        payload: { ...rest, scheduledAtIso: scheduledAt.toISOString() }
      }
    });
  }

  async enqueuePurchaseConfirmationClient(input: PurchaseConfirmationClientPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "PURCHASE_CONFIRMATION_CLIENT",
        payload: input
      }
    });
  }

  async enqueuePurchaseConfirmationProvider(input: PurchaseConfirmationProviderPayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "PURCHASE_CONFIRMATION_PROVIDER",
        payload: input
      }
    });
  }

  async enqueueWaitlistWelcome(input: WaitlistWelcomePayload) {
    return prisma.emailDeliveryQueue.create({
      data: {
        template: "WAITLIST_WELCOME",
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
        // deleteMany em vez de delete: se outra chamada concorrente a
        // processRetryQueue (produção usa lock via advisory lock no job,
        // mas nada impede uma segunda instância/teste chamando o serviço
        // direto) já processou essa mesma linha entre o findMany acima e
        // aqui, delete() lançaria P2025 (registro não encontrado) - não faz
        // sentido derrubar esse item pra retry só porque ele já foi
        // resolvido por outro lado.
        await prisma.emailDeliveryQueue.deleteMany({ where: { id: entry.id } });
      } catch (error) {
        const attempts = entry.attempts + 1;
        const delaySeconds =
          RETRY_DELAY_SECONDS[Math.min(attempts - 1, RETRY_DELAY_SECONDS.length - 1)] ??
          RETRY_DELAY_SECONDS[RETRY_DELAY_SECONDS.length - 1]!;
        const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
        const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);

        const exhausted = attempts >= MAX_RETRY_ATTEMPTS;
        // updateMany pelo mesmo motivo do deleteMany acima.
        await prisma.emailDeliveryQueue.updateMany({
          where: { id: entry.id },
          data: {
            attempts,
            nextRetryAt,
            lastError,
            failedAt: exhausted ? new Date() : null
          }
        });

        // Épico de Frentes, Frente 9, Lote 12: item que esgota as tentativas
        // ficava marcado como falho sem gerar nenhum alerta - só era
        // descoberto no expurgo de 30 dias (purgeOldFailures), muito tarde
        // pra ser útil (o e-mail nunca chega ao destinatário de qualquer
        // forma, mas ninguém ficava sabendo que isso aconteceu).
        if (exhausted) {
          Sentry.captureException(error, {
            tags: { area: "email-queue" },
            extra: { queueId: entry.id, template: entry.template, attempts }
          });
        }
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
    if (template === "EXTERNAL_STUDENT_INVITE") {
      const parsed = this.parseExternalStudentInvitePayload(payload);
      await this.emailService.sendExternalStudentInviteEmail(parsed);
      return;
    }
    if (template === "PASSWORD_CHANGED") {
      const parsed = this.parsePasswordChangedPayload(payload);
      await this.emailService.sendPasswordChangedEmail(parsed);
      return;
    }
    if (template === "RECOVERY_EMAIL_UPDATED") {
      const parsed = this.parseRecoveryEmailUpdatedPayload(payload);
      await this.emailService.sendRecoveryEmailUpdated(parsed);
      return;
    }
    if (template === "DATA_EXPORT_CONFIRMATION") {
      const parsed = this.parseDataExportConfirmationPayload(payload);
      await this.emailService.sendDataExportConfirmation(parsed);
      return;
    }
    if (template === "ACCOUNT_DELETED") {
      const parsed = this.parseAccountDeletedPayload(payload);
      await this.emailService.sendAccountDeleted(parsed);
      return;
    }
    if (template === "SUPPORT_REPLY") {
      const parsed = this.parseSupportReplyPayload(payload);
      await this.emailService.sendSupportReplyEmail(parsed);
      return;
    }
    if (template === "BOOKING_CONFIRMATION_CLIENT") {
      const parsed = this.parseBookingConfirmationClientPayload(payload);
      await this.emailService.sendBookingConfirmationToClient(parsed);
      return;
    }
    if (template === "BOOKING_CONFIRMATION_PROVIDER") {
      const parsed = this.parseBookingConfirmationProviderPayload(payload);
      await this.emailService.sendBookingConfirmationToProvider(parsed);
      return;
    }
    if (template === "PURCHASE_CONFIRMATION_CLIENT") {
      const parsed = this.parsePurchaseConfirmationClientPayload(payload);
      await this.emailService.sendPurchaseConfirmationToClient(parsed);
      return;
    }
    if (template === "PURCHASE_CONFIRMATION_PROVIDER") {
      const parsed = this.parsePurchaseConfirmationProviderPayload(payload);
      await this.emailService.sendPurchaseConfirmationToProvider(parsed);
      return;
    }
    if (template === "WAITLIST_WELCOME") {
      const parsed = this.parseWaitlistWelcomePayload(payload);
      await this.emailService.sendWaitlistWelcomeEmail(parsed);
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

  private parseExternalStudentInvitePayload(payload: Record<string, unknown>): ExternalStudentInvitePayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const studentName = typeof payload.studentName === "string" ? payload.studentName : "";
    const providerName = typeof payload.providerName === "string" ? payload.providerName : "";
    const inviteToken = typeof payload.inviteToken === "string" ? payload.inviteToken : "";
    const expiresDays = typeof payload.expiresDays === "number" ? payload.expiresDays : 0;
    if (!to || !studentName || !providerName || !inviteToken || !expiresDays) {
      throw new Error("Invalid EXTERNAL_STUDENT_INVITE payload.");
    }
    this.validateEmail(to);
    return { to, studentName, providerName, inviteToken, expiresDays };
  }

  private parsePasswordChangedPayload(payload: Record<string, unknown>): PasswordChangedPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!to || !name) {
      throw new Error("Invalid PASSWORD_CHANGED payload.");
    }
    this.validateEmail(to);
    return { to, name };
  }

  private parseRecoveryEmailUpdatedPayload(payload: Record<string, unknown>): RecoveryEmailUpdatedPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    const recoveryEmail = typeof payload.recoveryEmail === "string" ? payload.recoveryEmail : "";
    if (!to || !name || !recoveryEmail) {
      throw new Error("Invalid RECOVERY_EMAIL_UPDATED payload.");
    }
    this.validateEmail(to);
    return { to, name, recoveryEmail };
  }

  private parseDataExportConfirmationPayload(payload: Record<string, unknown>): DataExportConfirmationPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!to || !name) {
      throw new Error("Invalid DATA_EXPORT_CONFIRMATION payload.");
    }
    this.validateEmail(to);
    return { to, name };
  }

  private parseAccountDeletedPayload(payload: Record<string, unknown>): AccountDeletedPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!to || !name) {
      throw new Error("Invalid ACCOUNT_DELETED payload.");
    }
    this.validateEmail(to);
    return { to, name };
  }

  private parseSupportReplyPayload(payload: Record<string, unknown>): SupportReplyPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const userName = typeof payload.userName === "string" ? payload.userName : "";
    const responseMessage = typeof payload.responseMessage === "string" ? payload.responseMessage : "";
    const subject = typeof payload.subject === "string" ? payload.subject : null;
    if (!to || !userName || !responseMessage) {
      throw new Error("Invalid SUPPORT_REPLY payload.");
    }
    this.validateEmail(to);
    return { to, userName, subject, responseMessage };
  }

  private parseBookingConfirmationClientPayload(payload: Record<string, unknown>): {
    to: string;
    clientName: string;
    providerName: string;
    scheduledAt: Date;
    categoryName: string;
    priceCents: number;
  } {
    const to = typeof payload.to === "string" ? payload.to : "";
    const clientName = typeof payload.clientName === "string" ? payload.clientName : "";
    const providerName = typeof payload.providerName === "string" ? payload.providerName : "";
    const categoryName = typeof payload.categoryName === "string" ? payload.categoryName : "";
    const priceCents = typeof payload.priceCents === "number" ? payload.priceCents : NaN;
    const scheduledAtIso = typeof payload.scheduledAtIso === "string" ? payload.scheduledAtIso : "";
    const scheduledAt = new Date(scheduledAtIso);
    if (!to || !clientName || !providerName || !categoryName || Number.isNaN(priceCents) || Number.isNaN(scheduledAt.getTime())) {
      throw new Error("Invalid BOOKING_CONFIRMATION_CLIENT payload.");
    }
    this.validateEmail(to);
    return { to, clientName, providerName, scheduledAt, categoryName, priceCents };
  }

  private parseBookingConfirmationProviderPayload(payload: Record<string, unknown>): {
    to: string;
    providerName: string;
    clientName: string;
    scheduledAt: Date;
    categoryName: string;
    priceCents: number;
  } {
    const to = typeof payload.to === "string" ? payload.to : "";
    const providerName = typeof payload.providerName === "string" ? payload.providerName : "";
    const clientName = typeof payload.clientName === "string" ? payload.clientName : "";
    const categoryName = typeof payload.categoryName === "string" ? payload.categoryName : "";
    const priceCents = typeof payload.priceCents === "number" ? payload.priceCents : NaN;
    const scheduledAtIso = typeof payload.scheduledAtIso === "string" ? payload.scheduledAtIso : "";
    const scheduledAt = new Date(scheduledAtIso);
    if (!to || !providerName || !clientName || !categoryName || Number.isNaN(priceCents) || Number.isNaN(scheduledAt.getTime())) {
      throw new Error("Invalid BOOKING_CONFIRMATION_PROVIDER payload.");
    }
    this.validateEmail(to);
    return { to, providerName, clientName, scheduledAt, categoryName, priceCents };
  }

  private parsePurchaseConfirmationClientPayload(payload: Record<string, unknown>): PurchaseConfirmationClientPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const clientName = typeof payload.clientName === "string" ? payload.clientName : "";
    const providerName = typeof payload.providerName === "string" ? payload.providerName : "";
    const serviceName = typeof payload.serviceName === "string" ? payload.serviceName : "";
    const priceCents = typeof payload.priceCents === "number" ? payload.priceCents : NaN;
    if (!to || !clientName || !providerName || !serviceName || Number.isNaN(priceCents)) {
      throw new Error("Invalid PURCHASE_CONFIRMATION_CLIENT payload.");
    }
    this.validateEmail(to);
    return { to, clientName, providerName, serviceName, priceCents };
  }

  private parsePurchaseConfirmationProviderPayload(payload: Record<string, unknown>): PurchaseConfirmationProviderPayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const providerName = typeof payload.providerName === "string" ? payload.providerName : "";
    const clientName = typeof payload.clientName === "string" ? payload.clientName : "";
    const serviceName = typeof payload.serviceName === "string" ? payload.serviceName : "";
    const priceCents = typeof payload.priceCents === "number" ? payload.priceCents : NaN;
    if (!to || !providerName || !clientName || !serviceName || Number.isNaN(priceCents)) {
      throw new Error("Invalid PURCHASE_CONFIRMATION_PROVIDER payload.");
    }
    this.validateEmail(to);
    return { to, providerName, clientName, serviceName, priceCents };
  }

  private parseWaitlistWelcomePayload(payload: Record<string, unknown>): WaitlistWelcomePayload {
    const to = typeof payload.to === "string" ? payload.to : "";
    const audience = payload.audience === "CLIENT" || payload.audience === "PROFESSIONAL" ? payload.audience : null;
    if (!to || !audience) {
      throw new Error("Invalid WAITLIST_WELCOME payload.");
    }
    this.validateEmail(to);
    return { to, audience };
  }

  async purgeOldFailures(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await prisma.emailDeliveryQueue.deleteMany({
      where: { failedAt: { not: null, lt: cutoff } }
    });
    return result.count;
  }
}
