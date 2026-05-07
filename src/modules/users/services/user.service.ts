import {
  AnamnesisStatus,
  BankAccountType,
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
import {
  decryptSensitiveText,
  encryptSensitiveText
} from "../../../shared/utils/encryption";
import { resolveEffectiveUserRole } from "../../../shared/utils/admin-access";
import { compareHash, hashValue } from "../../../shared/utils/hash";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";

type UpdateMeInput = {
  name?: string;
  phone?: string;
  email?: string;
  photoUrl?: string;
};

type UpsertProviderBankAccountInput = {
  bankName: string;
  accountType: BankAccountType;
  agency: string;
  accountNumber: string;
  accountDigit: string;
  holderName: string;
  holderDocument: string;
  pixKey?: string;
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
  private serializeBankAccount(
    bankAccount:
      | {
          id: string;
          providerId: string;
          bankName: string;
          accountType: BankAccountType;
          agency: string;
          accountNumber: string;
          accountDigit: string;
          holderName: string;
          holderDocument: string;
          pixKey: string | null;
          createdAt: Date;
          updatedAt: Date;
        }
      | null
      | undefined
  ) {
    if (!bankAccount) {
      return bankAccount ?? null;
    }

    return {
      ...bankAccount,
      bankName: decryptSensitiveText(bankAccount.bankName) ?? "",
      agency: decryptSensitiveText(bankAccount.agency) ?? "",
      accountNumber: decryptSensitiveText(bankAccount.accountNumber) ?? "",
      accountDigit: decryptSensitiveText(bankAccount.accountDigit) ?? "",
      holderName: decryptSensitiveText(bankAccount.holderName) ?? "",
      holderDocument: decryptSensitiveText(bankAccount.holderDocument) ?? "",
      pixKey: decryptSensitiveText(bankAccount.pixKey)
    };
  }

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
        email: true,
        phone: true,
        photoUrl: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        providerProfile: {
          include: {
            categoryLinks: {
              include: {
                category: true
              }
            },
            bankAccount: true
          }
        }
      }
    });

    if (!user) {
      return user;
    }

    const effectiveRole = resolveEffectiveUserRole(user.email, user.role);
    return {
      ...user,
      photoUrl: this.mapUserPhotoUrl(user),
      role: effectiveRole,
      providerProfile: user.providerProfile
        ? {
            ...user.providerProfile,
            photoUrl: this.mapProviderPhotoUrl(user.providerProfile),
            bankAccount: this.serializeBankAccount(user.providerProfile.bankAccount)
          }
        : null
    };
  }

  async updateMe(userId: string, input: UpdateMeInput) {
    const nextName = input.name?.trim();
    const nextPhone = input.phone?.trim();
    const nextEmail = input.email?.trim().toLowerCase();
    // Empty string means "remove photo" (set to null); undefined means "don't change"
    const nextPhotoUrl = input.photoUrl === "" ? null : input.photoUrl;

    if (!nextName && !nextPhone && !nextEmail && input.photoUrl === undefined) {
      throw new AppError("Informe ao menos um campo para atualizar.", StatusCodes.BAD_REQUEST);
    }

    if (nextEmail) {
      const existingByEmail = await prisma.user.findUnique({
        where: { email: nextEmail },
        select: { id: true }
      });
      if (existingByEmail && existingByEmail.id !== userId) {
        throw new AppError("E-mail já está em uso.", StatusCodes.BAD_REQUEST);
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(nextName ? { name: nextName } : {}),
        ...(nextPhone ? { phone: nextPhone } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
        ...(nextPhotoUrl !== undefined ? { photoUrl: nextPhotoUrl } : {})
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        photoUrl: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return {
      ...updated,
      photoUrl: this.mapUserPhotoUrl(updated),
      role: resolveEffectiveUserRole(updated.email, updated.role)
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
      data: {
        password: await hashValue(input.newPassword)
      }
    });

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

  async getProviderBankAccount(userId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        bankAccount: true
      }
    });

    if (!provider) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }

    return this.serializeBankAccount(provider.bankAccount);
  }

  async upsertProviderBankAccount(userId: string, input: UpsertProviderBankAccountInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user || user.role !== UserRole.PROVIDER) {
      throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true }
    });

    if (!provider) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }

    return prisma.providerBankAccount.upsert({
      where: { providerId: provider.id },
      update: {
        bankName: encryptSensitiveText(input.bankName),
        accountType: input.accountType,
        agency: encryptSensitiveText(input.agency),
        accountNumber: encryptSensitiveText(input.accountNumber),
        accountDigit: encryptSensitiveText(input.accountDigit),
        holderName: encryptSensitiveText(input.holderName),
        holderDocument: encryptSensitiveText(input.holderDocument),
        pixKey: input.pixKey?.trim() ? encryptSensitiveText(input.pixKey) : null
      },
      create: {
        providerId: provider.id,
        bankName: encryptSensitiveText(input.bankName),
        accountType: input.accountType,
        agency: encryptSensitiveText(input.agency),
        accountNumber: encryptSensitiveText(input.accountNumber),
        accountDigit: encryptSensitiveText(input.accountDigit),
        holderName: encryptSensitiveText(input.holderName),
        holderDocument: encryptSensitiveText(input.holderDocument),
        pixKey: input.pixKey?.trim() ? encryptSensitiveText(input.pixKey) : null
      }
    });
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

  async deleteMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const anonymizedEmail = `deleted_${userId}@removed.invalid`;
    await prisma.$transaction([
      prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      }),
      prisma.pushDevice.updateMany({
        where: { userId },
        data: {
          isActive: false,
          invalidAt: new Date()
        }
      }),
      prisma.notificationPreference.deleteMany({
        where: { userId }
      }),
      prisma.userNotification.deleteMany({
        where: { userId }
      }),
      prisma.passwordResetToken.deleteMany({
        where: { userId }
      }),
      prisma.emailVerificationToken.deleteMany({
        where: { userId }
      }),
      prisma.clientAnamnesis.deleteMany({
        where: { clientId: userId }
      }),
      prisma.completionEvidence.deleteMany({
        where: { userId }
      }),
      prisma.supportTicket.updateMany({
        where: { userId },
        data: {
          subject: "Conta removida",
          message: "Conteudo removido por solicitacao do usuario."
        }
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          name: "Usuário removido",
          email: anonymizedEmail,
          phone: null,
          photoUrl: null,
          recoveryEmailEncrypted: null,
          password: ""
        }
      })
    ]);
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
            createdAt: true
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
          select: { status: true, completedAt: true, createdAt: true }
        },
        notificationPreferences: {
          select: { type: true, enabled: true }
        }
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
      anamnesis: user.anamnesisProfile,
      notificationPreferences: user.notificationPreferences
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
