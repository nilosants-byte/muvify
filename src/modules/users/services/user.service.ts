import { randomUUID } from "node:crypto";
import {
  AnamnesisStatus,
  NotificationPreferenceType,
  Prisma,
  SupportTicketStatus,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { EmailService } from "../../../shared/services/email.service";
import { getCache, setCache } from "../../../shared/utils/cache";
import { resolveAccessTokenTtlSeconds, setTokenBlacklist } from "../../../shared/security/token-blacklist";
import {
  decryptSensitiveText,
  encryptSensitiveText
} from "../../../shared/utils/encryption";
import { resolveEffectiveUserRole } from "../../../shared/utils/admin-access";
import { compareHash, hashValue } from "../../../shared/utils/hash";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { PresentialPackageService } from "../../presential-packages/services/presential-package.service";
import { ConsultancyService } from "../../consultancy/services/consultancy.service";

const presentialPackageService = new PresentialPackageService();
const consultancyService = new ConsultancyService();

const ACTIVE_PACKAGE_STATUSES = ["PENDING_PAYMENT", "ACTIVE", "PAST_DUE"] as const;
const ACTIVE_CONTRACT_STATUSES = ["PENDING_PAYMENT", "ACTIVE", "DELIVERED"] as const;
// cancelContract só aceita ACTIVE/DELIVERED (PENDING_PAYMENT ainda não tem
// nada cobrado de verdade — resolve sozinho via webhook/expiração).
const CANCELLABLE_CONTRACT_STATUSES = ["ACTIVE", "DELIVERED"] as const;

type UpdateMeInput = {
  name?: string;
  apelido?: string;
  phone?: string;
  photoUrl?: string;
};

type UpsertMyAnamnesisInput = {
  status?: AnamnesisStatus;
  answers?: Prisma.InputJsonValue;
};

type ChangeMyPasswordInput = {
  currentPassword: string;
  newPassword: string;
};

type UpsertRecoveryEmailInput = {
  recoveryEmail: string;
};

type SendSupportMessageInput = {
  subject?: string;
  message: string;
};

type RecordConsentInput = {
  termsVersion: string;
  acceptedAt?: string;
};

type NotificationPreferenceInput = {
  type: NotificationPreferenceType;
  enabled: boolean;
};

const emailService = new EmailService();
const ALLOWED_PHOTO_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function checkImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/png":
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      );
    case "image/webp":
      return (
        buffer.length >= 12 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      );
    default:
      return false;
  }
}

export class UserService {
  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private mapUserPhotoUrl(user: { id: string; photoUrl: string | null; updatedAt?: Date | null }) {
    return toUserPhotoUrl(user.id, user.photoUrl, user.updatedAt ?? null);
  }

  private mapProviderPhotoUrl(provider: {
    id: string;
    photoUrl: string | null;
    updatedAt?: Date | null;
  }) {
    return toProviderPhotoUrl(provider.id, provider.photoUrl, provider.updatedAt ?? null);
  }

  private recoveryEmailCacheKey(userId: string) {
    return `users:security:recovery-email:${userId}`;
  }

  private async resolveRecoveryEmail(
    userId: string,
    fallbackEmail: string,
    persistedRecoveryEmailEncrypted?: string | null
  ) {
    const normalizedFallback = this.normalizeEmail(fallbackEmail);
    const persistedRecoveryEmail = decryptSensitiveText(persistedRecoveryEmailEncrypted);
    if (persistedRecoveryEmail) {
      const normalizedPersisted = this.normalizeEmail(persistedRecoveryEmail);
      return {
        recoveryEmail: normalizedPersisted,
        custom: normalizedPersisted !== normalizedFallback
      };
    }

    const fromCache = await getCache<string>(this.recoveryEmailCacheKey(userId));
    const recoveryEmail = typeof fromCache === "string" && fromCache.trim().length > 0
      ? this.normalizeEmail(fromCache)
      : normalizedFallback;
    return {
      recoveryEmail,
      custom: recoveryEmail !== normalizedFallback
    };
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        apelido: true,
        email: true,
        phone: true,
        photoUrl: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        providerProfile: {
          // Never select mpAccessToken/mpRefreshToken/mpTokenExpiresAt or the CREF
          // review internals here — this payload reaches the client device.
          select: {
            id: true,
            userId: true,
            displayName: true,
            bio: true,
            experienceYears: true,
            priceCents: true,
            serviceRadiusKm: true,
            latitude: true,
            longitude: true,
            serviceMode: true,
            fixedLocations: true,
            excludedLocations: true,
            averageRating: true,
            totalReviews: true,
            photoUrl: true,
            presentationVideoUrl: true,
            mpAccountId: true,
            crefNumber: true,
            crefValidatedAt: true,
            crefValidationStatus: true,
            specialties: true,
            createdAt: true,
            updatedAt: true,
            categoryLinks: {
              include: {
                category: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return user;
    }

    const effectiveRole = resolveEffectiveUserRole(user.email, user.role, user.emailVerifiedAt);
    return {
      ...user,
      photoUrl: this.mapUserPhotoUrl(user),
      role: effectiveRole,
      providerProfile: user.providerProfile
        ? {
            ...user.providerProfile,
            photoUrl: this.mapProviderPhotoUrl(user.providerProfile)
          }
        : null
    };
  }

  async updateMe(userId: string, input: UpdateMeInput) {
    const nextName = input.name?.trim();
    const nextApelido = input.apelido?.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30);
    const nextPhoneRaw = input.phone?.trim();
    const nextPhone = nextPhoneRaw ? nextPhoneRaw.replace(/\D/g, "") : undefined;
    // Empty string means "remove photo" (set to null); undefined means "don't change"
    const nextPhotoUrl = input.photoUrl === "" ? null : input.photoUrl;

    if (!nextName && !nextApelido && !nextPhone && input.photoUrl === undefined) {
      throw new AppError("Informe ao menos um campo para atualizar.", StatusCodes.BAD_REQUEST);
    }
    if (nextApelido) {
      if (!/^[a-z0-9_]{3,30}$/.test(nextApelido)) {
        throw new AppError("Apelido inválido. Use apenas letras minúsculas, números e _.", StatusCodes.BAD_REQUEST);
      }
      const existingByApelido = await prisma.user.findFirst({
        where: { apelido: nextApelido },
        select: { id: true }
      });
      if (existingByApelido && existingByApelido.id !== userId) {
        throw new AppError("Apelido já está em uso.", StatusCodes.BAD_REQUEST);
      }
    }
    if (nextPhone && !/^\d{8,15}$/.test(nextPhone)) {
      throw new AppError("Telefone invalido. Informe entre 8 e 15 digitos.", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(nextName ? { name: nextName } : {}),
        ...(nextApelido ? { apelido: nextApelido } : {}),
        ...(nextPhone ? { phone: nextPhone } : {}),
        ...(nextPhotoUrl !== undefined ? { photoUrl: nextPhotoUrl } : {})
      },
      select: {
        id: true,
        name: true,
        apelido: true,
        email: true,
        phone: true,
        photoUrl: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return {
      ...updated,
      photoUrl: this.mapUserPhotoUrl(updated),
      role: resolveEffectiveUserRole(updated.email, updated.role, updated.emailVerifiedAt)
    };
  }

  async changeMyPassword(userId: string, input: ChangeMyPasswordInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        password: true
      }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const validCurrentPassword = await compareHash(input.currentPassword, user.password);
    if (!validCurrentPassword) {
      throw new AppError("Senha atual inválida.", StatusCodes.BAD_REQUEST);
    }

    const sameAsCurrent = await compareHash(input.newPassword, user.password);
    if (sameAsCurrent) {
      throw new AppError(
        "A nova senha deve ser diferente da senha atual.",
        StatusCodes.BAD_REQUEST
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashValue(input.newPassword) }
    });

    // Revogar todas as sessões ativas (outros dispositivos)
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    // Blacklistar tokens de acesso ativos
    const nowSeconds = Math.floor(Date.now() / 1000);
    await setTokenBlacklist(user.id, nowSeconds, resolveAccessTokenTtlSeconds()).catch(() => {/* best effort */});

    if (emailService.canSendEmail()) {
      void emailService
        .sendPasswordChangedEmail({
          to: user.email,
          name: user.name
        })
        .catch((error) => {
          console.error("Falha ao enviar e-mail de confirmação de troca de senha:", error);
        });
    }

    return { success: true };
  }

  async getRecoveryEmail(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        recoveryEmailEncrypted: true
      }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const resolved = await this.resolveRecoveryEmail(
      user.id,
      user.email,
      user.recoveryEmailEncrypted
    );
    return {
      recoveryEmail: resolved.recoveryEmail,
      accountEmail: user.email,
      custom: resolved.custom
    };
  }

  async upsertRecoveryEmail(userId: string, input: UpsertRecoveryEmailInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true
      }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const recoveryEmail = this.normalizeEmail(input.recoveryEmail);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        recoveryEmailEncrypted: encryptSensitiveText(recoveryEmail)
      }
    });
    await setCache(this.recoveryEmailCacheKey(user.id), recoveryEmail, 60 * 60 * 24 * 365);

    if (emailService.canSendEmail()) {
      void emailService
        .sendRecoveryEmailUpdated({
          to: recoveryEmail,
          name: user.name,
          recoveryEmail
        })
        .catch((error) => {
          console.error("Falha ao enviar confirmação de e-mail de recuperação:", error);
        });
    }

    return {
      recoveryEmail,
      accountEmail: user.email,
      custom: recoveryEmail !== this.normalizeEmail(user.email)
    };
  }

  async sendSupportMessage(userId: string, input: SendSupportMessageInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        recoveryEmailEncrypted: true
      }
    });

    if (!user) {
      throw new AppError("Usuario nao encontrado.", StatusCodes.NOT_FOUND);
    }

    const supportRecipient = env.SUPPORT_EMAIL_RECIPIENT?.trim() || env.SMTP_FROM?.trim();
    const recovery = await this.resolveRecoveryEmail(
      user.id,
      user.email,
      user.recoveryEmailEncrypted
    );
    const normalizedMessage = input.message.trim();
    const normalizedSubject = input.subject?.trim() || null;
    const emailSubject = normalizedSubject ?? "Solicitacao enviada pelo app";

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject: normalizedSubject,
        message: normalizedMessage,
        status: SupportTicketStatus.OPEN
      },
      select: {
        id: true
      }
    });

    if (!emailService.canSendEmail() || !supportRecipient) {
      console.info("[SUPPORT_QUEUE] Solicitacao registrada sem envio de e-mail.", {
        ticketId: ticket.id,
        userId: user.id,
        userRole: user.role,
        subject: emailSubject,
        messageLength: normalizedMessage.length,
        hasRecoveryEmail: recovery.custom
      });
      return { ticketId: ticket.id, delivered: false, queued: true };
    }

    await emailService.sendSupportMessageEmail({
      to: supportRecipient,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      subject: emailSubject,
      message: normalizedMessage,
      recoveryEmail: recovery.recoveryEmail
    });

    return { ticketId: ticket.id, delivered: true, queued: false };
  }

  async getPhotoById(userId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { photoUrl: true }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const rawPhotoUrl = user.photoUrl ?? "";
    const match = rawPhotoUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
    if (!match) {
      throw new AppError("Foto não disponível.", StatusCodes.NOT_FOUND);
    }

    const mimeType = match[1]!;
    if (!ALLOWED_PHOTO_MIMES.has(mimeType)) {
      throw new AppError("Foto não disponível.", StatusCodes.NOT_FOUND);
    }

    const buffer = Buffer.from(match[2]!, "base64");
    if (!buffer.length || !checkImageMagicBytes(buffer, mimeType)) {
      throw new AppError("Foto inválida ou corrompida.", StatusCodes.BAD_REQUEST);
    }

    return { buffer, mimeType };
  }

  async getMyAnamnesis(userId: string) {
    const anamnesis = await prisma.clientAnamnesis.findUnique({
      where: { clientId: userId }
    });

    if (anamnesis) {
      return anamnesis;
    }

    return {
      id: null,
      clientId: userId,
      status: AnamnesisStatus.DRAFT,
      answers: null,
      completedAt: null,
      createdAt: null,
      updatedAt: null
    };
  }

  async upsertMyAnamnesis(userId: string, input: UpsertMyAnamnesisInput) {
    const status = input.status ?? AnamnesisStatus.DRAFT;
    const completedAt = status === AnamnesisStatus.COMPLETED ? new Date() : null;

    return prisma.clientAnamnesis.upsert({
      where: { clientId: userId },
      update: {
        status,
        answers: typeof input.answers === "undefined" ? undefined : input.answers,
        completedAt
      },
      create: {
        clientId: userId,
        status,
        answers: input.answers,
        completedAt
      }
    });
  }

  async deleteMe(userId: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const valid = await compareHash(password, user.password);
    if (!valid) {
      throw new AppError("Senha incorreta. Confirme sua senha para excluir a conta.", StatusCodes.UNAUTHORIZED);
    }

    // Raio-X de pagamentos, Rodada 4, Lote 2: deleteMe não verificava nada
    // antes de anonimizar — um cliente com dívida em aberto (a mesma que já
    // bloqueia novas compras) podia simplesmente excluir a conta pra
    // escapar dela. Mesmo princípio pro lado profissional: dívida e disputa
    // aberta também bloqueiam, porque saem do controle de qualquer
    // reconciliação depois que a conta some.
    const providerProfileForCheck = await prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true }
    });

    const [
      clientDebt,
      clientDispute,
      clientPackage,
      clientContract,
      providerDebt,
      providerDispute
    ] = await Promise.all([
      prisma.debtRecord.findFirst({
        where: { clientId: userId, debtorType: "CLIENT", status: { in: ["PENDING", "NOTIFIED"] } }
      }),
      prisma.disputeCase.findFirst({ where: { clientId: userId, status: "OPEN" } }),
      prisma.presentialPackage.findFirst({
        where: { clientId: userId, status: { in: [...ACTIVE_PACKAGE_STATUSES] } }
      }),
      prisma.consultancyContract.findFirst({
        where: { clientId: userId, status: { in: [...ACTIVE_CONTRACT_STATUSES] } }
      }),
      providerProfileForCheck
        ? prisma.debtRecord.findFirst({
            where: { providerId: providerProfileForCheck.id, debtorType: "PROVIDER", status: { in: ["PENDING", "NOTIFIED"] } }
          })
        : null,
      providerProfileForCheck
        ? prisma.disputeCase.findFirst({ where: { providerId: providerProfileForCheck.id, status: "OPEN" } })
        : null
    ]);

    if (clientDebt || providerDebt) {
      throw new AppError(
        "Você tem uma pendência financeira em aberto. Regularize antes de excluir sua conta.",
        StatusCodes.CONFLICT
      );
    }
    if (clientDispute || providerDispute) {
      throw new AppError(
        "Você tem um caso em julgamento aguardando decisão. Aguarde a resolução antes de excluir sua conta.",
        StatusCodes.CONFLICT
      );
    }
    if (clientPackage) {
      throw new AppError(
        "Você tem um pacote presencial ativo. Cancele-o em Meus Pacotes antes de excluir sua conta.",
        StatusCodes.CONFLICT
      );
    }
    if (clientContract) {
      throw new AppError(
        "Você tem uma consultoria ativa. Cancele-a antes de excluir sua conta.",
        StatusCodes.CONFLICT
      );
    }

    // Profissional: relacionamentos ativos que ELE tem com alunos não
    // bloqueiam a exclusão (forçar encerrar aluno por aluno antes de sair
    // seria desproporcional) — em vez disso, são encerrados automaticamente
    // aqui, com o mesmo mecanismo de cancelamento (e aviso/reembolso) já
    // usado quando qualquer uma das partes cancela manualmente. Roda ANTES
    // da transação principal porque envolve chamada de rede pro Mercado
    // Pago (nunca dentro de uma transação Prisma).
    if (providerProfileForCheck) {
      const [activePackages, activeContracts] = await Promise.all([
        prisma.presentialPackage.findMany({
          where: { providerId: providerProfileForCheck.id, status: { in: [...ACTIVE_PACKAGE_STATUSES] } },
          select: { id: true }
        }),
        prisma.consultancyContract.findMany({
          where: { providerId: providerProfileForCheck.id, status: { in: [...CANCELLABLE_CONTRACT_STATUSES] } },
          select: { id: true }
        })
      ]);
      for (const pkg of activePackages) {
        await presentialPackageService.cancelPackage(userId, pkg.id).catch((error) =>
          console.error(`Falha ao cancelar pacote ${pkg.id} na exclusão de conta do profissional ${userId}:`, error)
        );
      }
      for (const contract of activeContracts) {
        await consultancyService.cancelContract(userId, contract.id).catch((error) =>
          console.error(`Falha ao cancelar contrato ${contract.id} na exclusão de conta do profissional ${userId}:`, error)
        );
      }
    }

    const anonymizedEmail = `deleted_${userId}@removed.invalid`;
    const newPassword = await hashValue(randomUUID());

    // Interactive transaction garante atomicidade total, incluindo o lookup do providerProfile
    await prisma.$transaction(async (tx) => {
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.pushDevice.updateMany({ where: { userId }, data: { isActive: false, invalidAt: new Date() } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.userNotification.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.twoFactorLoginChallenge.deleteMany({ where: { userId } });
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
      await tx.customerPaymentMethod.deleteMany({ where: { userId } });
      await tx.payment.updateMany({
        where: { booking: { clientId: userId } },
        data: { mpPaymentId: null, mpCardToken: null, mpChargeId: null, failureReason: null }
      });
      await tx.clientAnamnesis.deleteMany({ where: { clientId: userId } });
      await tx.bookingMessage.updateMany({ where: { senderId: userId }, data: { content: "[Mensagem removida]", senderId: null } });
      await tx.completionEvidence.deleteMany({ where: { userId } });
      // Raio-X de pagamentos, Rodada 3, Lote 6: a Política de Privacidade
      // promete reter o conteúdo de tickets de suporte por 5 anos pra defesa
      // de direitos (Cláusula de retenção) — anonimizar na hora, só porque a
      // conta foi excluída, quebrava essa promessa pra qualquer ticket ainda
      // dentro do prazo. O job periódico de retenção
      // (DataRetentionService::cleanupSupportTickets) já é o único
      // responsável por anonimizar tickets, e só faz isso quando o ticket
      // realmente passa dos 5 anos — independente da conta ainda existir ou
      // já ter sido excluída. O usuário já fica anonimizado na própria
      // tabela User logo abaixo; o ticket não precisa de nenhuma ação aqui.
      await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } });
      await tx.feedPost.deleteMany({ where: { userId } });
      await tx.review.updateMany({ where: { userId }, data: { comment: null } });
      await tx.providerStudentAssessment.deleteMany({ where: { clientId: userId } });
      await tx.consultancyRequest.updateMany({ where: { clientId: userId }, data: { trainingNeedText: null, limitationText: null, extraInfoText: null, providerResponseText: null } });
      await tx.consultancyContract.updateMany({ where: { clientId: userId }, data: { mpPaymentId: null, mpRefundId: null } });
      await tx.booking.updateMany({ where: { clientId: userId }, data: { notes: null, sessionLocation: null } });
      await tx.trainingPlanCompletion.updateMany({ where: { clientId: userId }, data: { notes: null } });
      await tx.userAchievement.deleteMany({ where: { userId } });
      await tx.userXpTransaction.deleteMany({ where: { userId } });
      await tx.userStreak.deleteMany({ where: { userId } });
      await tx.rankingSnapshot.deleteMany({ where: { userId } });

      // Lookup dentro da transação garante atomicidade do delete do provider
      const provProfile = await tx.providerProfile.findUnique({ where: { userId }, select: { id: true } });
      if (provProfile) {
        await tx.providerBankAccount.deleteMany({ where: { providerId: provProfile.id } });
        await tx.availability.deleteMany({ where: { providerId: provProfile.id } });
        await tx.providerCalendarEvent.deleteMany({ where: { providerId: provProfile.id } });
        await tx.providerManualBlock.deleteMany({ where: { providerId: provProfile.id } });
        await tx.onlineConsultancySetting.deleteMany({ where: { providerId: provProfile.id } });
        await tx.exercise.deleteMany({ where: { providerId: provProfile.id, isPrebuilt: false } });
        await tx.trainingPlan.deleteMany({ where: { providerId: provProfile.id } });
        await tx.financialIncome.deleteMany({ where: { providerId: provProfile.id } });
        await tx.financialExpense.deleteMany({ where: { providerId: provProfile.id } });
        await tx.financialStudent.deleteMany({ where: { providerId: provProfile.id } });
        await tx.financialGoal.deleteMany({ where: { providerId: provProfile.id } });
        await tx.financialClassSession.deleteMany({ where: { providerId: provProfile.id } });
        await tx.providerStudentAssessment.deleteMany({ where: { providerId: provProfile.id } });
        await tx.providerProfile.updateMany({
          where: { userId },
          data: {
            displayName: "Personal removido", bio: "", photoUrl: null, presentationVideoUrl: null,
            latitude: null, longitude: null, fixedLocations: Prisma.DbNull, excludedLocations: Prisma.DbNull,
            crefNumber: null, crefDocumentUrl: null, credentialDocuments: Prisma.DbNull,
            // Raio-X de pagamentos, Rodada 4, Lote 2: sem isso, cobranças
            // recorrentes (renovação de ficha, ciclo de pacote) continuavam
            // sendo capturadas e repassadas pra uma conta já excluída — os
            // relacionamentos ativos já foram encerrados acima, mas limpa o
            // token de qualquer forma como segunda camada de segurança.
            mpAccessToken: null, mpRefreshToken: null, mpAccountId: null, mpTokenInvalidatedAt: new Date()
          }
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: { name: "Usuário removido", email: anonymizedEmail, phone: null, photoUrl: null, recoveryEmailEncrypted: null, password: newPassword }
      });
    }, { timeout: 30_000 }); // 30s timeout para contas com muito histórico
  }

  async exportMyData(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        photoUrl: true,
        role: true,
        termsAcceptedAt: true,
        privacyPolicyAcceptedAt: true,
        termsVersion: true,
        createdAt: true,
        updatedAt: true,
        bookings: {
          select: {
            id: true,
            scheduledAt: true,
            status: true,
            priceCents: true,
            currency: true,
            notes: true,
            createdAt: true,
            payment: {
              select: { method: true, status: true, amountCents: true, authorizedAt: true, capturedAt: true, refundedAt: true }
            }
          },
          orderBy: { scheduledAt: "desc" }
        },
        reviews: {
          select: { id: true, rating: true, comment: true, createdAt: true }
        },
        consultancyRequestsSent: {
          select: {
            id: true,
            status: true,
            trainingNeedText: true,
            limitationText: true,
            createdAt: true
          }
        },
        anamnesisProfile: {
          select: { answers: true, status: true, completedAt: true, createdAt: true }
        },
        consultancyContracts: {
          select: {
            id: true,
            status: true,
            paymentMethod: true,
            paymentStatus: true,
            paymentAmountCents: true,
            deliveryDeadlineAt: true,
            deliveredAt: true,
            refundedAt: true,
            createdAt: true,
            trainingPlans: {
              select: {
                id: true,
                title: true,
                description: true,
                createdAt: true,
                exercises: {
                  select: { id: true, name: true, repetitionsSets: true, load: true, sortOrder: true }
                }
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        },
        trainingPlanCompletions: {
          select: { id: true, notes: true, completedAt: true, createdAt: true },
          orderBy: { completedAt: "desc" },
          take: 200,
        },
        notificationPreferences: {
          select: { type: true, enabled: true }
        },
        chatMessages: {
          select: { id: true, bookingId: true, senderId: true, content: true, isSystem: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        },
        favorites: {
          select: { id: true, providerId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
        following: {
          select: { id: true, followingId: true, createdAt: true },
        },
        feedPosts: {
          select: { id: true, type: true, imageUrl: true, caption: true, isAutomatic: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 200,
        },
        unlockedAchievements: {
          select: { id: true, achievement: { select: { key: true, name: true } }, unlockedAt: true },
          orderBy: { unlockedAt: "desc" },
        },
      }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        photoUrl: user.photoUrl,
        role: user.role,
        termsAcceptedAt: user.termsAcceptedAt,
        privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt,
        termsVersion: user.termsVersion,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      bookings: user.bookings,
      reviews: user.reviews,
      consultancyRequests: user.consultancyRequestsSent,
      consultancyContracts: user.consultancyContracts,
      trainingPlanCompletions: user.trainingPlanCompletions,
      anamnesis: user.anamnesisProfile,
      notificationPreferences: user.notificationPreferences,
      chatMessages: user.chatMessages,
      favorites: user.favorites,
      following: user.following,
      feedPosts: user.feedPosts,
      unlockedAchievements: user.unlockedAchievements,
    };
  }

  async recordConsent(userId: string, input: RecordConsentInput) {
    const acceptedAt = input.acceptedAt ? new Date(input.acceptedAt) : new Date();

    return prisma.user.update({
      where: { id: userId },
      data: {
        termsAcceptedAt: acceptedAt,
        privacyPolicyAcceptedAt: acceptedAt,
        termsVersion: input.termsVersion
      },
      select: {
        id: true,
        termsAcceptedAt: true,
        privacyPolicyAcceptedAt: true,
        termsVersion: true
      }
    });
  }

  async getNotificationPreferences(userId: string) {
    const saved = await prisma.notificationPreference.findMany({
      where: { userId },
      select: { type: true, enabled: true }
    });

    const savedMap = new Map(saved.map((p) => [p.type, p.enabled]));
    const allTypes = Object.values(NotificationPreferenceType);
    return allTypes.map((type) => ({
      type,
      enabled: savedMap.has(type) ? savedMap.get(type)! : true
    }));
  }

  async upsertNotificationPreferences(userId: string, preferences: NotificationPreferenceInput[]) {
    await Promise.all(
      preferences.map((pref) =>
        prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: pref.type } },
          update: { enabled: pref.enabled },
          create: { userId, type: pref.type, enabled: pref.enabled }
        })
      )
    );
    return this.getNotificationPreferences(userId);
  }
}
