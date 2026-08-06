import { randomUUID } from "node:crypto";
import {
  AnamnesisStatus,
  NotificationPreferenceType,
  Prisma,
  SupportTicketStatus,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import * as Sentry from "@sentry/node";
import { env } from "../../../config/env";
import { CURRENT_TERMS_VERSION } from "../../../config/legal";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { EmailService } from "../../../shared/services/email.service";
import { EmailQueueService } from "../../../shared/services/email-queue.service";
import { deleteMediaByUrl, deletePrivateObject, getPrivateObject } from "../../../shared/services/storage.service";
import { getCache, setCache } from "../../../shared/utils/cache";
import { resolveAccessTokenTtlSeconds, setTokenBlacklist } from "../../../shared/security/token-blacklist";
import {
  decryptAssessmentFields,
  decryptJson,
  decryptSensitiveText,
  encryptJson,
  encryptSensitiveText
} from "../../../shared/utils/encryption";
import { resolveEffectiveUserRole } from "../../../shared/utils/admin-access";
import { compareHash, hashValue } from "../../../shared/utils/hash";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { PresentialPackageService } from "../../presential-packages/services/presential-package.service";
import { ConsultancyService } from "../../consultancy/services/consultancy.service";
import { BookingService } from "../../bookings/services/booking.service";

const presentialPackageService = new PresentialPackageService();
const consultancyService = new ConsultancyService();
const bookingService = new BookingService();

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
  password: string;
};

type SendSupportMessageInput = {
  subject?: string;
  message: string;
};

type RecordConsentInput = {
  // Épico de Frentes, Frente 11, Lote 1: termsVersion/acceptedAt enviados
  // pelo corpo NUNCA são usados pra gravar - existiam antes só porque o
  // endpoint pedia o cliente mandar, sem nenhuma comparação contra uma
  // versão vigente conhecida pelo servidor. O tipo mantém os campos (o
  // validator ainda aceita o corpo antigo, pra não quebrar clientes já em
  // produção) mas o service ignora e sempre grava a versão canônica.
  termsVersion?: string;
  acceptedAt?: string;
  ip?: string;
  userAgent?: string;
};

type NotificationPreferenceInput = {
  type: NotificationPreferenceType;
  enabled: boolean;
};

const emailService = new EmailService();
const emailQueueService = new EmailQueueService();
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

// Épico de Frentes, Frente 11, Lote 6: credentialDocuments guarda um array
// de { uri, ... } - a chave privada do R2 só é extraída quando uri começa
// com "cref-documents/" (mesmo critério já usado em
// provider.service.ts::upsertOwnCredentials pra validar propriedade).
// Frente 2 (segunda camada), Lote 8: este arquivo não tinha nenhum import de
// Sentry — falhas aqui (inclusive apagar mídia do R2 durante exclusão de
// conta, o gap mais grave: o usuário recebe confirmação de "conta excluída"
// mas o arquivo continua no R2 porque a chamada de deleção falhou em
// silêncio) só chegavam ao console, nunca a um alerta de verdade.
function reportR2CleanupFailure(context: string, error: unknown) {
  console.error(`Falha ao apagar ${context} no R2 (exclusão de conta):`, error);
  Sentry.captureException(error, { tags: { area: "users", phase: "account_deletion_r2_cleanup" }, extra: { context } });
}

function extractCredentialDocumentKeys(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === "object" && "uri" in item ? (item as { uri: unknown }).uri : null))
    .filter((uri): uri is string => typeof uri === "string" && uri.startsWith("cref-documents/"));
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
        twoFactorEnabled: true,
        termsVersion: true,
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
      // Épico de Frentes, Frente 11, Lote 1: nada indicava ao app que os
      // termos vigentes mudaram - usuário antigo ficava sob versão
      // desatualizada indefinidamente, sem nenhum gate de re-aceite.
      needsReconsent: user.termsVersion !== CURRENT_TERMS_VERSION,
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
        twoFactorEnabled: true,
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

    // Épico de Frentes, Frente 9, Lote 11: era um envio síncrono sem retry -
    // se o SMTP caísse justamente nesse instante (ex: troca de senha
    // indevida por invasor), a vítima nunca era avisada por nenhum canal.
    if (emailService.canSendEmail()) {
      await emailQueueService
        .enqueuePasswordChanged({
          to: user.email,
          name: user.name
        })
        .catch((error) => {
          console.error("Falha ao enfileirar e-mail de confirmação de troca de senha:", error);
        });
    }

    return { success: true };
  }

  // Tela "Meus aparelhos conectados": lista as sessões ativas (não
  // revogadas, não expiradas) do usuário. Cada rotação de refresh token gera
  // uma linha nova (ver AuthService.refresh) - como a linha antiga sempre
  // fica revogada na hora, só sobra uma linha "viva" por aparelho de fato
  // logado, então essa listagem já é naturalmente por aparelho, não por
  // evento técnico de rotação.
  async listMySessions(userId: string, currentSessionId?: string) {
    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    });
    return sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      lastActiveAt: session.createdAt,
      isCurrent: session.id === currentSessionId
    }));
  }

  // Desconecta um aparelho à distância. Não é instantâneo de verdade: o
  // access token que aquele aparelho já tem em mãos continua funcionando
  // até expirar sozinho (ACCESS_TOKEN_EXPIRES_IN, hoje 15min) - só a
  // renovação seguinte (refresh) é que vai falhar. Mesma limitação que já
  // existe em todo o sistema de blacklist de token (é por usuário inteiro,
  // não por sessão - blacklistar só esse aparelho exigiria checar
  // Session.revokedAt em toda requisição autenticada, custo que não se
  // justifica aqui).
  async revokeMySession(userId: string, sessionId: string) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new AppError("Sessão não encontrada.", StatusCodes.NOT_FOUND);
    }
    if (session.revokedAt) {
      return { success: true };
    }
    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() }
    });
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
        email: true,
        password: true
      }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const validPassword = await compareHash(input.password, user.password);
    if (!validPassword) {
      throw new AppError("Senha atual inválida.", StatusCodes.BAD_REQUEST);
    }

    const recoveryEmail = this.normalizeEmail(input.recoveryEmail);
    const accountEmail = this.normalizeEmail(user.email);
    if (recoveryEmail === accountEmail) {
      throw new AppError(
        "O e-mail de recuperação não pode ser igual ao e-mail de login da conta.",
        StatusCodes.BAD_REQUEST
      );
    }

    // Frente 3 (Cadastro/onboarding), Lote 1: e-mail de recuperação não pode
    // coincidir com o e-mail de login de OUTRA conta - reduz a superfície de
    // reuso do mesmo endereço em contas comprometidas.
    const emailInUse = await prisma.user.findUnique({
      where: { email: recoveryEmail },
      select: { id: true }
    });
    if (emailInUse && emailInUse.id !== user.id) {
      throw new AppError(
        "Este e-mail já é usado como login por outra conta.",
        StatusCodes.BAD_REQUEST
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        recoveryEmailEncrypted: encryptSensitiveText(recoveryEmail)
      }
    });
    await setCache(this.recoveryEmailCacheKey(user.id), recoveryEmail, 60 * 60 * 24 * 365);

    if (emailService.canSendEmail()) {
      // Avisa tanto o endereço novo quanto o e-mail de login real da conta -
      // antes só o novo era avisado, então o dono legítimo nunca ficava
      // sabendo que essa troca aconteceu. Épico de Frentes, Frente 9, Lote
      // 11: passa a usar a fila com retry (mesmo motivo do e-mail de senha
      // alterada acima).
      await emailQueueService
        .enqueueRecoveryEmailUpdated({
          to: recoveryEmail,
          name: user.name,
          recoveryEmail
        })
        .catch((error) => {
          console.error("Falha ao enfileirar confirmação de e-mail de recuperação:", error);
        });
      if (accountEmail !== recoveryEmail) {
        await emailQueueService
          .enqueueRecoveryEmailUpdated({
            to: user.email,
            name: user.name,
            recoveryEmail
          })
          .catch((error) => {
            console.error("Falha ao enfileirar aviso à conta sobre troca de e-mail de recuperação:", error);
          });
      }
    }

    return {
      recoveryEmail,
      accountEmail: user.email,
      custom: recoveryEmail !== accountEmail
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

    // Épico de Frentes, Frente 10, Lote 2: reabrir um assunto criava um
    // ticket novo sem vínculo nenhum com o anterior - admin perdia o
    // histórico da conversa ao responder. Vincula ao ANSWERED mais
    // recente do usuário, se existir.
    const mostRecentAnswered = await prisma.supportTicket.findFirst({
      where: { userId: user.id, status: SupportTicketStatus.ANSWERED },
      orderBy: { respondedAt: "desc" },
      select: { id: true }
    });

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject: normalizedSubject,
        message: normalizedMessage,
        status: SupportTicketStatus.OPEN,
        parentTicketId: mostRecentAnswered?.id
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

  // Épico de Frentes, Frente 10, Lote 2: não existia nenhum endpoint pro
  // próprio usuário listar os tickets que abriu e ler a resposta do admin
  // - só POST de criação. O deep-link SUPPORT_REPLY (Frente 9/Lote 18)
  // navegava pra um formulário de abrir chamado novo, não pra resposta.
  async listMySupportTickets(userId: string) {
    return prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        message: true,
        status: true,
        adminResponse: true,
        respondedAt: true,
        parentTicketId: true,
        createdAt: true
      }
    });
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
      return { ...anamnesis, answers: decryptJson(anamnesis.answers) };
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
    const answers = typeof input.answers === "undefined" ? undefined : encryptJson(input.answers);

    const saved = await prisma.clientAnamnesis.upsert({
      where: { clientId: userId },
      update: {
        status,
        answers,
        completedAt
      },
      create: {
        clientId: userId,
        status,
        answers,
        completedAt
      }
    });
    return { ...saved, answers: decryptJson(saved.answers) };
  }

  async deleteMe(userId: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, name: true, email: true, legalHoldUntil: true, legalHoldReason: true }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    // Épico de Frentes, Frente 11, Lote 6: legalHoldUntil nunca era checado
    // aqui - um titular sob retenção legal obrigatória (processo judicial em
    // curso, por exemplo) conseguia anonimizar a própria conta e escapar da
    // obrigação, mesmo o mecanismo já existindo e sendo respeitado pelo job
    // de retenção automática e pelo caminho de exclusão feito pelo admin.
    if (user.legalHoldUntil && user.legalHoldUntil > new Date()) {
      throw new AppError(
        "Sua conta está sob retenção legal obrigatória e não pode ser excluída no momento. Entre em contato com o suporte para mais informações.",
        StatusCodes.CONFLICT
      );
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
    // Épico de Frentes, Frente 11, Lote 6: pacote/consultoria ativos do
    // CLIENTE bloqueavam a exclusão pedindo cancelamento manual antes -
    // inconsistente com o lado profissional (abaixo), que já cancela
    // automaticamente em vez de bloquear. Mesmo mecanismo de cancelamento
    // (e aviso/reembolso) já usado quando qualquer uma das partes cancela
    // manualmente. Roda ANTES da transação principal porque envolve chamada
    // de rede pro Mercado Pago (nunca dentro de uma transação Prisma).
    if (clientPackage) {
      await presentialPackageService.cancelPackage(userId, clientPackage.id).catch((error) =>
        console.error(`Falha ao cancelar pacote ${clientPackage.id} na exclusão de conta do cliente ${userId}:`, error)
      );
    }
    if (clientContract) {
      await consultancyService.cancelContract(userId, clientContract.id).catch((error) =>
        console.error(`Falha ao cancelar contrato ${clientContract.id} na exclusão de conta do cliente ${userId}:`, error)
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

      // Frente 5 (Descoberta, agendamento e agenda), Lote 2: mesma lacuna de
      // "pacotes/consultorias eram encerrados, mas agendamentos avulsos
      // não" — cliente com sessão avulsa já paga ficava sem resolução
      // proativa quando o profissional excluía a própria conta.
      await bookingService
        .cancelActiveStandaloneBookingsForProviderRemoval(providerProfileForCheck.id)
        .catch((error) =>
          console.error(`Falha ao cancelar agendamentos avulsos na exclusão de conta do profissional ${userId}:`, error)
        );
    }

    const anonymizedEmail = `deleted_${userId}@removed.invalid`;
    const newPassword = await hashValue(randomUUID());

    // Épico de Frentes, Frente 8, Lote 10: precisa ler as imageUrl ANTES da
    // transação apagar os FeedPost - excluir conta nunca limpava a mídia
    // correspondente no R2, ficava órfã pra sempre mesmo com o registro já
    // apagado do banco.
    const feedPostsToCleanup = await prisma.feedPost.findMany({
      where: { userId, imageUrl: { not: null } },
      select: { imageUrl: true },
    });

    // Épico de Frentes, Frente 11, Lote 6: só feed-photos era limpo -
    // comprovação de presença, foto/vídeo/documentos do profissional e
    // mídia de exercício próprio ficavam órfãos no R2 pra sempre.
    const completionEvidencesToCleanup = await prisma.completionEvidence.findMany({
      where: { userId, storageKey: { not: null } },
      select: { storageKey: true }
    });
    const providerMediaToCleanup = providerProfileForCheck
      ? await prisma.providerProfile.findUnique({
          where: { id: providerProfileForCheck.id },
          select: { photoUrl: true, presentationVideoUrl: true, crefDocumentUrl: true, credentialDocuments: true }
        })
      : null;
    const providerExercisesToCleanup = providerProfileForCheck
      ? await prisma.exercise.findMany({
          where: { providerId: providerProfileForCheck.id, isPrebuilt: false, mediaUrl: { not: null } },
          select: { mediaUrl: true }
        })
      : [];

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
      // Épico de Frentes, Frente 9, Lote 6: anonimizar o BookingMessage não
      // era suficiente - a UserNotification já entregue ao destinatário
      // (título/corpo com o nome do remetente e um trecho da mensagem, ver
      // chat.controller.ts::sendMessage) pertence ao destinatário, não ao
      // autor excluído, e nunca era tocada por essa exclusão.
      const sentMessageIds = (
        await tx.bookingMessage.findMany({ where: { senderId: userId }, select: { id: true } })
      ).map((m) => m.id);
      await tx.bookingMessage.updateMany({ where: { senderId: userId }, data: { content: "[Mensagem removida]", senderId: null } });
      if (sentMessageIds.length > 0) {
        await tx.$executeRaw`
          UPDATE "UserNotification"
          SET "title" = '💬 Usuário removido', "body" = '[Mensagem removida]'
          WHERE "data"->>'type' = 'CHAT_MESSAGE'
            AND "data"->>'messageId' IN (${Prisma.join(sentMessageIds)})
        `;
      }
      // Épico de Frentes, Frente 11, Lote 6: mesma assimetria do
      // BookingMessage acima, do lado do chat de consultoria - nunca era
      // tocado por essa exclusão.
      const sentConsultancyMessageIds = (
        await tx.consultancyMessage.findMany({ where: { senderId: userId }, select: { id: true } })
      ).map((m) => m.id);
      await tx.consultancyMessage.updateMany({ where: { senderId: userId }, data: { content: "[Mensagem removida]", senderId: null } });
      if (sentConsultancyMessageIds.length > 0) {
        await tx.$executeRaw`
          UPDATE "UserNotification"
          SET "title" = '💬 Usuário removido', "body" = '[Mensagem removida]'
          WHERE "data"->>'type' = 'CHAT_MESSAGE'
            AND "data"->>'messageId' IN (${Prisma.join(sentConsultancyMessageIds)})
        `;
      }
      // Épico de Frentes, Frente 11, Lote 6: denúncias de conteúdo
      // submetidas por este usuário (feed/chat) ficavam com o texto livre
      // original mesmo após a conta ser anonimizada.
      await tx.feedPostReport.updateMany({ where: { reporterId: userId }, data: { reason: null } });
      await tx.bookingMessageReport.updateMany({ where: { reporterId: userId }, data: { reason: null } });
      await tx.consultancyMessageReport.updateMany({ where: { reporterId: userId }, data: { reason: null } });
      // Motivo de no-show (relatado por ou sobre este usuário) é texto livre
      // que pode narrar detalhes da falta - mesmo tratamento.
      await tx.noShowReport.updateMany({
        where: { OR: [{ reportedByUserId: userId }, { reportedUserId: userId }] },
        data: { reportReason: null, contestReason: null }
      });
      // Nota de contexto de disputa - só alcançável aqui se a disputa não
      // estiver mais OPEN (disputa aberta já bloqueia a exclusão acima).
      await tx.disputeCase.updateMany({
        where: { OR: [{ clientId: userId }, ...(providerProfileForCheck ? [{ providerId: providerProfileForCheck.id }] : [])] },
        data: { contextNote: null }
      });
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
      // Épico de Frentes, Frente 11, Lote 6: curtidas feitas por este
      // usuário em posts de OUTRAS pessoas ficavam associadas ao registro
      // já anonimizado pra sempre (as próprias curtidas NOS posts dele já
      // cascateiam junto com o feedPost.deleteMany abaixo).
      await tx.feedPostLike.deleteMany({ where: { userId } });
      // Épico de Frentes, Frente 8, Lote 14: os posts do próprio usuário
      // (linha abaixo) cascateiam a limpeza de likes/comments NELES, mas
      // comentários que esse usuário deixou em posts DE OUTRAS PESSOAS
      // continuavam intactos com o conteúdo original, atribuídos ao
      // registro já anonimizado - inconsistente com o padrão já usado pros
      // outros campos neste mesmo método (mensagem, review, textos de
      // solicitação, todos anulados explicitamente).
      await tx.feedPostComment.updateMany({
        where: { userId, post: { userId: { not: userId } } },
        data: { content: "[Comentário removido]" }
      });
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
        await tx.providerStudentAssessment.deleteMany({ where: { providerId: provProfile.id } });
        await tx.crefDocumentUpload.deleteMany({ where: { uploadedByUser: userId } });
        // Épico de Frentes, Frente 11, Lote 6: post de conclusão de treino
        // (WORKOUT_COMPLETED) do ALUNO guarda um retrato ("snapshot") do
        // nome/foto do profissional em metadata no momento da postagem, pra
        // renderizar a UI de colaboração no feed - se o profissional exclui
        // a conta depois, esses posts (que não são dele, não são tocados
        // pelo feedPost.deleteMany acima) continuavam exibindo o nome/foto
        // antigos indefinidamente.
        await tx.$executeRaw`
          UPDATE "FeedPost"
          SET metadata = jsonb_set(jsonb_set(COALESCE(metadata, '{}'::jsonb), '{providerName}', '"Personal removido"'), '{providerPhotoUrl}', 'null'::jsonb)
          WHERE metadata->>'providerId' = ${provProfile.id}
        `;
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
        data: {
          name: "Usuário removido", email: anonymizedEmail, phone: null, photoUrl: null,
          recoveryEmailEncrypted: null, password: newPassword,
          // Épico de Frentes, Frente 11, Lote 6: identificadores residuais
          // que ficavam intactos numa conta "excluída" - CPF, apelido
          // público, segredo de 2FA, e referências ao Mercado Pago do
          // cliente (o lado profissional já limpa as suas acima).
          document: null, documentHash: null, apelido: null,
          twoFactorSecret: null, twoFactorEnabled: false, twoFactorEnabledAt: null,
          mpCustomerId: null, mpDefaultCardId: null, suspensionReason: null
        }
      });
    }, { timeout: 30_000 }); // 30s timeout para contas com muito histórico

    await Promise.all([
      ...feedPostsToCleanup.map((p) =>
        deleteMediaByUrl(p.imageUrl!).catch((e) => reportR2CleanupFailure("mídia de post", e))
      ),
      ...completionEvidencesToCleanup.map((c) =>
        deletePrivateObject(c.storageKey!).catch((e) => reportR2CleanupFailure("comprovação de presença", e))
      ),
      ...(providerMediaToCleanup?.photoUrl ? [deleteMediaByUrl(providerMediaToCleanup.photoUrl).catch((e) => reportR2CleanupFailure("foto do profissional", e))] : []),
      ...(providerMediaToCleanup?.presentationVideoUrl ? [deleteMediaByUrl(providerMediaToCleanup.presentationVideoUrl).catch((e) => reportR2CleanupFailure("vídeo de apresentação", e))] : []),
      ...(providerMediaToCleanup?.crefDocumentUrl ? [deletePrivateObject(providerMediaToCleanup.crefDocumentUrl).catch((e) => reportR2CleanupFailure("documento de CREF", e))] : []),
      ...extractCredentialDocumentKeys(providerMediaToCleanup?.credentialDocuments).map((key) =>
        deletePrivateObject(key).catch((e) => reportR2CleanupFailure("documento de credencial", e))
      ),
      ...providerExercisesToCleanup.map((ex) =>
        deleteMediaByUrl(ex.mediaUrl!).catch((e) => reportR2CleanupFailure("mídia de exercício", e))
      )
    ]);

    if (emailService.canSendEmail()) {
      await emailQueueService
        .enqueueAccountDeleted({ to: user.email, name: user.name })
        .catch((error) => {
          console.error("Falha ao enfileirar e-mail de confirmação de exclusão de conta:", error);
        });
    }
  }

  // Épico de Frentes, Frente 11, Lote 5: take:200/500 cortava listas longas
  // silenciosamente, sem o titular nunca saber que a exportação estava
  // incompleta. Busca limit+1 e corta o excedente aqui, marcando truncated.
  private sliceTruncated<T>(items: T[], limit: number): { items: T[]; truncated: boolean } {
    return { items: items.slice(0, limit), truncated: items.length > limit };
  }

  async exportMyData(userId: string) {
    const LIST_LIMIT = 500;
    const take = LIST_LIMIT + 1;

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
          orderBy: { scheduledAt: "desc" },
          take
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
          take
        },
        trainingPlanCompletions: {
          select: { id: true, notes: true, completedAt: true, createdAt: true },
          orderBy: { completedAt: "desc" },
          take
        },
        notificationPreferences: {
          select: { type: true, enabled: true }
        },
        chatMessages: {
          select: { id: true, bookingId: true, senderId: true, content: true, isSystem: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        favorites: {
          select: { id: true, providerId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
        following: {
          select: { id: true, followingId: true, createdAt: true },
        },
        // Épico de Frentes, Frente 11, Lote 5: só "following" (quem EU sigo)
        // estava presente - "followers" (quem me segue) é dado pessoal meu
        // (quem interage comigo na plataforma) tanto quanto o inverso.
        followers: {
          select: { id: true, followerId: true, createdAt: true },
        },
        feedPosts: {
          select: { id: true, type: true, imageUrl: true, caption: true, isAutomatic: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        feedPostLikes: {
          select: { id: true, postId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        feedPostComments: {
          select: { id: true, postId: true, content: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        feedPostReports: {
          select: { id: true, postId: true, reason: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        // Frente 11 (fechamento): feedPostReports estava presente, mas as
        // denúncias de chat (agendamento e consultoria) ficaram de fora -
        // mesmo gap de cobertura achado pro ConsentRecord/CompletionEvidence.
        bookingMessageReports: {
          select: { id: true, messageId: true, reason: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        consultancyMessageReports: {
          select: { id: true, messageId: true, reason: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        unlockedAchievements: {
          select: { id: true, achievement: { select: { key: true, name: true } }, unlockedAt: true },
          orderBy: { unlockedAt: "desc" },
        },
        // Dados antes ausentes da exportação (M1-M4, Frente 11, Lote 5):
        supportTicketsSubmitted: {
          select: { id: true, subject: true, message: true, status: true, adminResponse: true, respondedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        disputeCasesAsClient: {
          select: { id: true, type: true, status: true, amountCents: true, contextNote: true, resolution: true, resolvedAmountCents: true, resolvedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        noShowReportsFiled: {
          select: { id: true, bookingId: true, status: true, reportReason: true, contestReason: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        noShowReportsReceived: {
          select: { id: true, bookingId: true, status: true, reportReason: true, contestReason: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        debtRecords: {
          select: { id: true, amountCents: true, reason: true, status: true, paidAt: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        physicalAssessments: {
          select: {
            id: true, providerId: true, weight: true, height: true, imc: true, bodyFatPercent: true,
            muscleMass: true, circumferences: true, waist: true, hip: true, chest: true, arm: true, thigh: true,
            createdAt: true, updatedAt: true
          },
          orderBy: { updatedAt: "desc" }
        },
        consultancyMessages: {
          select: { id: true, contractId: true, content: true, isSystem: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        presentialPackages: {
          select: { id: true, providerId: true, status: true, mode: true, cycleAmountCents: true, sessionsPerCycle: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        pushDevices: {
          select: { id: true, platform: true, appVersion: true, deviceName: true, isActive: true, lastSeenAt: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        sessions: {
          select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        xpTransactions: {
          select: { id: true, amount: true, reason: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        streak: {
          select: { currentStreak: true, longestStreak: true, lastTrainingDate: true, trainingDaysPerWeek: true, updatedAt: true }
        },
        rankingSnapshots: {
          select: { periodType: true, periodKey: true, xpEarned: true, lastKnownPosition: true, updatedAt: true }
        },
        customerPaymentMethods: {
          select: { id: true, nickname: true, brand: true, last4: true, funding: true, expMonth: true, expYear: true, isDefault: true, isActive: true, createdAt: true }
        },
        // Frente 11 (fechamento): ConsentRecord (histórico de consentimento,
        // criado no Lote 1 pra dar prova ao titular) e CompletionEvidence
        // (selfie de comprovação de presença) ficaram de fora da exportação
        // original do Lote 5 - achado numa revisão de completude posterior.
        consentRecords: {
          select: { id: true, termsVersion: true, privacyPolicyVersion: true, acceptedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        completionEvidences: {
          select: { id: true, bookingId: true, cameraFacing: true, mimeType: true, storageKey: true, imageBase64: true, capturedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take
        },
        // Registro de posse do upload (chave no R2 + quem enviou), usado pra
        // validar vínculo antes de anexar a um envio de CREF - o conteúdo do
        // documento em si já está coberto por providerData.profile.
        crefDocumentUploads: {
          select: { id: true, storageKey: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        // Lado profissional (M4): antes completamente ausente da exportação.
        providerProfile: {
          select: {
            id: true,
            displayName: true,
            bio: true,
            experienceYears: true,
            priceCents: true,
            serviceMode: true,
            crefNumber: true,
            crefValidationStatus: true,
            specialties: true,
            createdAt: true,
            updatedAt: true,
            categoryLinks: {
              select: { category: { select: { name: true } } }
            },
            availabilities: {
              select: { weekday: true, startTime: true, endTime: true, isActive: true }
            },
            serviceOffers: {
              select: { id: true, kind: true, title: true, billingCycle: true, priceCents: true, isPromotion: true, promotionPriceCents: true, createdAt: true }
            },
            bookings: {
              select: { id: true, clientId: true, scheduledAt: true, status: true, priceCents: true, createdAt: true },
              orderBy: { scheduledAt: "desc" },
              take
            },
            reviews: {
              select: { id: true, rating: true, comment: true, providerResponse: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take
            },
            consultancyRequestsReceived: {
              select: { id: true, clientId: true, status: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take
            },
            consultancyContracts: {
              select: { id: true, clientId: true, status: true, paymentAmountCents: true, providerAmountCents: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take
            },
            presentialPackages: {
              select: { id: true, clientId: true, status: true, mode: true, cycleAmountCents: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take
            },
            disputeCases: {
              select: { id: true, type: true, status: true, amountCents: true, resolution: true, createdAt: true },
              orderBy: { createdAt: "desc" }
            },
            bankAccount: {
              select: { bankName: true, accountType: true, agency: true, accountNumber: true, accountDigit: true, holderName: true, holderDocument: true, pixKey: true }
            },
            debtRecords: {
              select: { id: true, amountCents: true, reason: true, status: true, paidAt: true, createdAt: true },
              orderBy: { createdAt: "desc" }
            },
            financialStudents: {
              select: { id: true, name: true, monthlyValueCents: true, type: true, isActive: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take
            },
            financialIncomes: {
              select: { id: true, description: true, amountCents: true, source: true, paidAt: true, createdAt: true },
              orderBy: { paidAt: "desc" },
              take
            },
            financialExpenses: {
              select: { id: true, description: true, amountCents: true, category: true, paidAt: true, createdAt: true },
              orderBy: { paidAt: "desc" },
              take
            },
            financialGoals: {
              select: { month: true, targetRevenueCents: true, targetStudents: true, targetWeeklyClasses: true }
            }
          }
        }
      }
    });

    if (!user) {
      throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
    }

    const bookings = this.sliceTruncated(user.bookings, LIST_LIMIT);
    const consultancyContracts = this.sliceTruncated(user.consultancyContracts, LIST_LIMIT);
    const trainingPlanCompletions = this.sliceTruncated(user.trainingPlanCompletions, LIST_LIMIT);
    const chatMessages = this.sliceTruncated(user.chatMessages, LIST_LIMIT);
    const feedPosts = this.sliceTruncated(user.feedPosts, LIST_LIMIT);
    const feedPostLikes = this.sliceTruncated(user.feedPostLikes, LIST_LIMIT);
    const feedPostComments = this.sliceTruncated(user.feedPostComments, LIST_LIMIT);
    const supportTickets = this.sliceTruncated(user.supportTicketsSubmitted, LIST_LIMIT);
    const consultancyMessages = this.sliceTruncated(user.consultancyMessages, LIST_LIMIT);
    const sessions = this.sliceTruncated(user.sessions, LIST_LIMIT);
    const xpTransactions = this.sliceTruncated(user.xpTransactions, LIST_LIMIT);
    const completionEvidences = this.sliceTruncated(user.completionEvidences, LIST_LIMIT);

    const providerBookings = user.providerProfile ? this.sliceTruncated(user.providerProfile.bookings, LIST_LIMIT) : null;
    const providerReviews = user.providerProfile ? this.sliceTruncated(user.providerProfile.reviews, LIST_LIMIT) : null;
    const providerConsultancyRequests = user.providerProfile ? this.sliceTruncated(user.providerProfile.consultancyRequestsReceived, LIST_LIMIT) : null;
    const providerConsultancyContracts = user.providerProfile ? this.sliceTruncated(user.providerProfile.consultancyContracts, LIST_LIMIT) : null;
    const providerPresentialPackages = user.providerProfile ? this.sliceTruncated(user.providerProfile.presentialPackages, LIST_LIMIT) : null;
    const providerFinancialStudents = user.providerProfile ? this.sliceTruncated(user.providerProfile.financialStudents, LIST_LIMIT) : null;
    const providerFinancialIncomes = user.providerProfile ? this.sliceTruncated(user.providerProfile.financialIncomes, LIST_LIMIT) : null;
    const providerFinancialExpenses = user.providerProfile ? this.sliceTruncated(user.providerProfile.financialExpenses, LIST_LIMIT) : null;

    // Frente 11 (fechamento): mesmo tratamento de decifragem já usado pra
    // anamnese/avaliação física/conta bancária - sem isso, a exportação
    // devolveria o texto cifrado em vez da comprovação de presença em si.
    const completionEvidencePhotos = await Promise.all(
      completionEvidences.items.map(async (evidence) => {
        let imageBase64: string | null = null;
        try {
          const encrypted = evidence.storageKey ? await getPrivateObject(evidence.storageKey) : evidence.imageBase64;
          imageBase64 = encrypted ? decryptSensitiveText(encrypted) : null;
        } catch (error) {
          console.error(`Falha ao decifrar CompletionEvidence ${evidence.id} para exportação:`, error);
        }
        return {
          id: evidence.id,
          bookingId: evidence.bookingId,
          cameraFacing: evidence.cameraFacing,
          mimeType: evidence.mimeType,
          capturedAt: evidence.capturedAt,
          createdAt: evidence.createdAt,
          imageBase64
        };
      })
    );

    // Épico de Frentes, Frente 11, Lote 5: exportação self-service não
    // deixava trilha nem avisava o titular por nenhum canal além do
    // download em si.
    await prisma.dataExportLog.create({ data: { userId: user.id } }).catch((error) => {
      console.error("Falha ao registrar DataExportLog:", error);
    });
    if (emailService.canSendEmail()) {
      await emailQueueService
        .enqueueDataExportConfirmation({ to: user.email, name: user.name })
        .catch((error) => {
          console.error("Falha ao enfileirar e-mail de confirmação de exportação:", error);
        });
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
      bookings: bookings.items,
      reviews: user.reviews,
      consultancyRequests: user.consultancyRequestsSent,
      consultancyContracts: consultancyContracts.items,
      trainingPlanCompletions: trainingPlanCompletions.items,
      // Épico de Frentes, Frente 11, Lote 3: answers passou a ser guardado
      // cifrado - sem isso aqui, a exportação devolveria o ciphertext em
      // vez do questionário em claro.
      anamnesis: user.anamnesisProfile
        ? { ...user.anamnesisProfile, answers: decryptJson(user.anamnesisProfile.answers) }
        : null,
      notificationPreferences: user.notificationPreferences,
      chatMessages: chatMessages.items,
      favorites: user.favorites,
      following: user.following,
      followers: user.followers,
      feedPosts: feedPosts.items,
      feedPostLikes: feedPostLikes.items,
      feedPostComments: feedPostComments.items,
      feedPostReports: user.feedPostReports,
      bookingMessageReports: user.bookingMessageReports,
      consultancyMessageReports: user.consultancyMessageReports,
      unlockedAchievements: user.unlockedAchievements,
      supportTickets: supportTickets.items,
      disputes: user.disputeCasesAsClient,
      noShowReportsFiled: user.noShowReportsFiled,
      noShowReportsReceived: user.noShowReportsReceived,
      debtRecords: user.debtRecords,
      physicalAssessments: user.physicalAssessments.map((a) => decryptAssessmentFields(a)),
      consultancyMessages: consultancyMessages.items,
      presentialPackages: user.presentialPackages,
      pushDevices: user.pushDevices,
      sessions: sessions.items,
      xpTransactions: xpTransactions.items,
      consentRecords: user.consentRecords,
      completionEvidences: completionEvidencePhotos,
      crefDocumentUploads: user.crefDocumentUploads,
      streak: user.streak,
      rankingSnapshots: user.rankingSnapshots,
      customerPaymentMethods: user.customerPaymentMethods,
      providerData: user.providerProfile
        ? {
            profile: {
              id: user.providerProfile.id,
              displayName: user.providerProfile.displayName,
              bio: user.providerProfile.bio,
              experienceYears: user.providerProfile.experienceYears,
              priceCents: user.providerProfile.priceCents,
              serviceMode: user.providerProfile.serviceMode,
              crefNumber: user.providerProfile.crefNumber,
              crefValidationStatus: user.providerProfile.crefValidationStatus,
              specialties: user.providerProfile.specialties,
              categories: user.providerProfile.categoryLinks.map((c) => c.category.name),
              createdAt: user.providerProfile.createdAt,
              updatedAt: user.providerProfile.updatedAt
            },
            availabilities: user.providerProfile.availabilities,
            serviceOffers: user.providerProfile.serviceOffers,
            bookingsReceived: providerBookings!.items,
            reviewsReceived: providerReviews!.items,
            consultancyRequestsReceived: providerConsultancyRequests!.items,
            consultancyContractsAsProvider: providerConsultancyContracts!.items,
            presentialPackagesOffered: providerPresentialPackages!.items,
            disputeCases: user.providerProfile.disputeCases,
            // Épico de Frentes, Frente 11, Lote 3: campos bancários cifrados
            // em repouso - decifra aqui pra devolver o valor real ao titular.
            bankAccount: user.providerProfile.bankAccount
              ? {
                  bankName: user.providerProfile.bankAccount.bankName,
                  accountType: user.providerProfile.bankAccount.accountType,
                  agency: decryptSensitiveText(user.providerProfile.bankAccount.agency),
                  accountNumber: decryptSensitiveText(user.providerProfile.bankAccount.accountNumber),
                  accountDigit: decryptSensitiveText(user.providerProfile.bankAccount.accountDigit),
                  holderName: decryptSensitiveText(user.providerProfile.bankAccount.holderName),
                  holderDocument: decryptSensitiveText(user.providerProfile.bankAccount.holderDocument),
                  pixKey: decryptSensitiveText(user.providerProfile.bankAccount.pixKey)
                }
              : null,
            debtRecords: user.providerProfile.debtRecords,
            financialStudents: providerFinancialStudents!.items,
            financialIncomes: providerFinancialIncomes!.items,
            financialExpenses: providerFinancialExpenses!.items,
            financialGoals: user.providerProfile.financialGoals
          }
        : null,
      truncated: {
        bookings: bookings.truncated,
        consultancyContracts: consultancyContracts.truncated,
        trainingPlanCompletions: trainingPlanCompletions.truncated,
        chatMessages: chatMessages.truncated,
        feedPosts: feedPosts.truncated,
        feedPostLikes: feedPostLikes.truncated,
        feedPostComments: feedPostComments.truncated,
        supportTickets: supportTickets.truncated,
        consultancyMessages: consultancyMessages.truncated,
        sessions: sessions.truncated,
        xpTransactions: xpTransactions.truncated,
        completionEvidences: completionEvidences.truncated,
        providerBookingsReceived: providerBookings?.truncated ?? false,
        providerReviewsReceived: providerReviews?.truncated ?? false,
        providerConsultancyRequestsReceived: providerConsultancyRequests?.truncated ?? false,
        providerConsultancyContracts: providerConsultancyContracts?.truncated ?? false,
        providerPresentialPackages: providerPresentialPackages?.truncated ?? false,
        providerFinancialStudents: providerFinancialStudents?.truncated ?? false,
        providerFinancialIncomes: providerFinancialIncomes?.truncated ?? false,
        providerFinancialExpenses: providerFinancialExpenses?.truncated ?? false
      }
    };
  }

  async recordConsent(userId: string, input: RecordConsentInput) {
    const acceptedAt = new Date();

    await prisma.consentRecord.create({
      data: {
        userId,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyPolicyVersion: CURRENT_TERMS_VERSION,
        acceptedAt,
        ip: input.ip,
        userAgent: input.userAgent
      }
    });

    return prisma.user.update({
      where: { id: userId },
      data: {
        termsAcceptedAt: acceptedAt,
        privacyPolicyAcceptedAt: acceptedAt,
        termsVersion: CURRENT_TERMS_VERSION
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
      // Épico de Frentes, Frente 11, Lote 2: MARKETING vinha com default
      // ligado (opt-out) igual qualquer outra categoria operacional -
      // finalidade de marketing precisa ser opt-in (desligada até o
      // usuário ativar de propósito), as demais continuam opt-out.
      enabled: savedMap.has(type) ? savedMap.get(type)! : type !== NotificationPreferenceType.MARKETING
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
