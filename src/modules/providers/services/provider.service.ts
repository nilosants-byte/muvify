import { randomUUID } from "node:crypto";
import {
  AnamnesisStatus,
  BookingStatus,
  CrefValidationStatus,
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  Prisma,
  PresentialPackageStatus,
  ProviderServiceMode,
  ServiceOfferKind,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { EmailService } from "../../../shared/services/email.service";
import { isAdminEmail } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";
import { deleteByPattern, getCache, setCache } from "../../../shared/utils/cache";
import { consultancyValidUntil } from "../../../shared/utils/consultancy-validity";
import { haversineKm } from "../../../shared/utils/geo";
import {
  toProviderPhotoUrl,
  toProviderVideoUrl,
  toUserPhotoUrl
} from "../../../shared/utils/photo-url";
import { createCrefDocumentSignatureQuery, verifyCrefDocumentSignature } from "../../../shared/utils/cref-document-signature";
import { getPrivateMediaBuffer } from "../../../shared/services/storage.service";
import { ENABLE_VIDEO_UPLOAD } from "../../../config/features";
import { NotificationService } from "../../notifications/services/notification.service";

type FixedLocation = {
  id?: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
};

type CreateProviderInput = {
  userId: string;
  displayName: string;
  bio: string;
  experienceYears: number;
  priceCents: number;
  photoUrl?: string;
  presentationVideoUrl?: string;
  serviceRadiusKm?: number;
  latitude?: number;
  longitude?: number;
  serviceMode?: ProviderServiceMode;
  fixedLocations?: FixedLocation[];
  excludedLocations?: string[];
  categoryIds?: string[];
  specialties?: string[];
  minBookingNoticeHours?: number;
};

type UpdateProviderInput = Partial<Omit<CreateProviderInput, "userId">>;

type SearchProvidersInput = {
  categoryId?: string;
  q?: string;
  minRating?: number;
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
  serviceMode?: ProviderServiceMode;
  take?: number;
  offset?: number;
};

function paginateProviders<T>(items: T[], offset: number, take?: number) {
  if (!Number.isFinite(offset) || offset < 0) return take ? items.slice(0, take) : items;
  if (!take) return items.slice(offset);
  return items.slice(offset, offset + take);
}

function formatDateKeyInTimezone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatTimeInTimezone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function weekdayInTimezone(date: Date, timeZone: string) {
  const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return map[short] ?? 0;
}

function parseMinutes(time: string) {
  const [h, m] = time.split(":").map((v) => Number(v));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function formatMinutes(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const m = (clamped % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function normalizeLoose(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sanitizeSpecialties(input?: string[] | null) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  input.forEach((item) => {
    if (typeof item !== "string") return;
    const trimmed = item.trim();
    if (!trimmed) return;
    const key = normalizeLoose(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(trimmed);
  });
  return output;
}

type CategoryClient = Pick<Prisma.TransactionClient, "serviceCategory">;

async function resolveCategoryIdsFromSpecialties(db: CategoryClient, specialties: string[]) {
  if (specialties.length === 0) return [];

  // 1. Fetch all existing categories matching the specialties in one query
  const existing = await db.serviceCategory.findMany({
    where: { name: { in: specialties, mode: "insensitive" } },
    select: { id: true, name: true }
  });

  const existingNamesLower = new Set(existing.map((c) => c.name.toLowerCase()));
  const toCreate = specialties.filter((s) => !existingNamesLower.has(s.toLowerCase()));

  // 2. Create missing ones in one batch
  if (toCreate.length > 0) {
    await db.serviceCategory.createMany({
      data: toCreate.map((name) => ({ name })),
      skipDuplicates: true
    });
  }

  // 3. Re-fetch to get IDs of newly created entries (createMany doesn't return IDs)
  const all = toCreate.length > 0
    ? await db.serviceCategory.findMany({
        where: { name: { in: specialties, mode: "insensitive" } },
        select: { id: true }
      })
    : existing;

  return Array.from(new Set(all.map((c) => c.id)));
}

type ProviderCalendarRangeInput = {
  from?: string;
  to?: string;
};

type ProviderCredentialDocumentInput = {
  id?: string;
  name: string;
  uri: string;
  mimeType?: string;
  createdAt?: string;
};

type UpsertProviderCredentialsInput = {
  crefNumber: string;
  crefDocumentUrl?: string;
  credentials?: ProviderCredentialDocumentInput[];
};

type ReviewProviderCrefInput = {
  decision: "APPROVE" | "REJECT";
  justification?: string;
};

type CrefValidationQueueStatus = "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";
const CREF_STATUS_IN_REVIEW = "IN_REVIEW" as CrefValidationStatus;

type ProviderManualCalendarEventInput = {
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
};

type UpsertStudentPhysicalAssessmentInput = {
  weight?: string;
  height?: string;
  imc?: string;
  bodyFatPercent?: string;
  muscleMass?: string;
  circumferences?: string;
  waist?: string;
  hip?: string;
  chest?: string;
  arm?: string;
  thigh?: string;
};

function serviceKindLabel(kind: ServiceOfferKind | "PRESENTIAL") {
  if (kind === "PRESENTIAL") return "Aulas presenciais";
  if (kind === ServiceOfferKind.ONLINE_CONSULTANCY) return "Consultoria on-line";
  if (kind === ServiceOfferKind.ONLINE_CONSULTANCY_SPECIALIZED)
    return "Consultoria on-line personalizada";
  return "Combo (Presencial + Consultoria on-line)";
}


function parseStudentAgeFromAnamnesis(answers: unknown) {
  if (!answers || typeof answers !== "object") return null;
  const maybePersonalData = (answers as { personalData?: unknown }).personalData;
  if (!maybePersonalData || typeof maybePersonalData !== "object") return null;
  const rawAge = (maybePersonalData as { age?: unknown }).age;
  if (typeof rawAge === "number" && Number.isFinite(rawAge) && rawAge > 0) {
    return Math.floor(rawAge);
  }
  if (typeof rawAge === "string") {
    const onlyDigits = rawAge.replace(/\D/g, "");
    if (!onlyDigits) return null;
    const parsed = Number(onlyDigits);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function parseRange(range: ProviderCalendarRangeInput) {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 3);
  const defaultTo = new Date(now);
  defaultTo.setDate(now.getDate() + 21);

  const from = range.from ? new Date(range.from) : defaultFrom;
  const to = range.to ? new Date(range.to) : defaultTo;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError("Período de calendário inválido.", StatusCodes.BAD_REQUEST);
  }

  if (from >= to) {
    throw new AppError("Intervalo do calendário inválido.", StatusCodes.BAD_REQUEST);
  }

  return { from, to };
}

// Scalar fields of ProviderProfile safe to return to any client (public search,
// provider detail, or the profile owner). Deliberately excludes payment OAuth
// tokens (mpAccessToken/mpRefreshToken/mpTokenExpiresAt) and CREF review
// internals (crefDocumentUrl/credentialDocuments/crefRejectionReason/
// crefReviewedAt/crefReviewedByUserId) — those must never leave the server.
const PUBLIC_PROVIDER_SELECT = {
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
  crefNumber: true,
  crefValidatedAt: true,
  crefValidationStatus: true,
  specialties: true,
  createdAt: true,
  updatedAt: true
} as const;

export class ProviderService {
  private emailService = new EmailService();

  private async getProviderByUserId(userId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true
      }
    });

    if (!provider) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }

    return provider;
  }

  private async assertAdminAccess(adminUserId: string) {
    const admin = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: {
        id: true,
        email: true,
        role: true
      }
    });

    if (!admin || !isAdminEmail(admin.email)) {
      throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
    }

    return admin;
  }

  private getCredentialDocuments(value: unknown): Array<{ uri?: string | null }> {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is { uri?: string | null } => {
      if (!item || typeof item !== "object") return false;
      return true;
    });
  }

  // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: documento novo
  // (upload privado) grava a própria chave do storage no campo "uri", não
  // uma URL — reconhecível por começar com o prefixo da pasta privada.
  // Documento antigo (pré-correção) continua com a URL pública real,
  // devolvida sem alteração (risco residual documentado e aceito).
  private resolveCredentialDocumentUri(providerId: string, uri: string | null | undefined) {
    if (!uri) return uri ?? null;
    if (!uri.startsWith("cref-documents/")) return uri;
    const filename = uri.slice("cref-documents/".length);
    const signature = createCrefDocumentSignatureQuery(providerId, uri);
    return `/providers/${providerId}/credentials/documents/${encodeURIComponent(filename)}?${signature}`;
  }

  private hasFrontAndBackCredentialDocuments(value: unknown) {
    const docs = this.getCredentialDocuments(value);
    const frontUri = typeof docs[0]?.uri === "string" ? docs[0].uri.trim() : "";
    const backUri = typeof docs[1]?.uri === "string" ? docs[1].uri.trim() : "";
    return Boolean(frontUri) && Boolean(backUri);
  }

  private isCrefApproved(profile: { crefValidationStatus?: CrefValidationStatus | null }) {
    return profile.crefValidationStatus === CrefValidationStatus.APPROVED;
  }

  private mapCredentialsPayload(provider: {
    id: string;
    crefNumber: string | null;
    crefDocumentUrl: string | null;
    credentialDocuments: Prisma.JsonValue;
    crefValidatedAt: Date | null;
    crefValidationStatus: CrefValidationStatus;
    crefRejectionReason: string | null;
    crefRejectionCount: number;
    crefReviewedAt: Date | null;
  }) {
    const credentials = this.getCredentialDocuments(provider.credentialDocuments).map((doc) => ({
      ...doc,
      uri: this.resolveCredentialDocumentUri(provider.id, doc.uri)
    }));
    return {
      providerId: provider.id,
      crefNumber: provider.crefNumber,
      crefDocumentUrl: provider.crefDocumentUrl,
      credentials,
      crefValidatedAt: provider.crefValidatedAt,
      crefValidationStatus: provider.crefValidationStatus,
      crefRejectionReason: provider.crefRejectionReason,
      crefRejectionCount: provider.crefRejectionCount,
      crefReviewedAt: provider.crefReviewedAt
    };
  }

  // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: rota assinada que
  // serve o documento de CREF (privado no R2) — validação por HMAC de
  // curta duração, não por sessão (o mesmo padrão já usado pra foto de
  // usuário, necessário porque a tag <Image> do app não envia header de
  // autorização).
  async getSignedCredentialDocument(input: {
    providerId: string;
    key: string;
    exp: string | number | undefined;
    sig: string | undefined;
  }) {
    if (
      !verifyCrefDocumentSignature({
        providerId: input.providerId,
        key: input.key,
        exp: input.exp,
        sig: input.sig
      })
    ) {
      throw new AppError("Assinatura de acesso a documento invalida.", StatusCodes.FORBIDDEN);
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: { credentialDocuments: true }
    });
    if (!provider) {
      throw new AppError("Perfil profissional nao encontrado.", StatusCodes.NOT_FOUND);
    }
    const docs = this.getCredentialDocuments(provider.credentialDocuments) as Array<{
      uri?: string | null;
      mimeType?: string | null;
    }>;
    const doc = docs.find((d) => d.uri === input.key);
    if (!doc) {
      throw new AppError("Documento nao encontrado.", StatusCodes.NOT_FOUND);
    }

    const buffer = await getPrivateMediaBuffer(input.key);
    return { buffer, mimeType: doc.mimeType || "application/octet-stream" };
  }

  async getOwnCredentials(userId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        crefNumber: true,
        crefDocumentUrl: true,
        credentialDocuments: true,
        crefValidatedAt: true,
        crefValidationStatus: true,
        crefRejectionReason: true,
        crefRejectionCount: true,
        crefReviewedAt: true
      }
    });

    if (!provider) {
      throw new AppError("Perfil profissional nao encontrado.", StatusCodes.NOT_FOUND);
    }

    return this.mapCredentialsPayload(provider);
  }

  async upsertOwnCredentials(userId: string, input: UpsertProviderCredentialsInput) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true, crefValidationStatus: true, crefReviewedAt: true }
    });

    if (!provider) {
      throw new AppError("Perfil profissional nao encontrado.", StatusCodes.NOT_FOUND);
    }

    if (provider.crefValidationStatus === CrefValidationStatus.REJECTED && provider.crefReviewedAt) {
      const cooldownDays = 7;
      const msSinceRejection = Date.now() - provider.crefReviewedAt.getTime();
      const daysSinceRejection = msSinceRejection / (1000 * 60 * 60 * 24);
      if (daysSinceRejection < cooldownDays) {
        const daysLeft = Math.ceil(cooldownDays - daysSinceRejection);
        throw new AppError(
          `Resubmissao de CREF disponivel em ${daysLeft} dia(s) apos a rejeicao.`,
          StatusCodes.TOO_MANY_REQUESTS
        );
      }
    }

    const sanitizedCredentials = (input.credentials ?? []).map((item) => ({
      id: item.id ?? randomUUID(),
      name: item.name.trim(),
      uri: item.uri.trim(),
      mimeType: item.mimeType?.trim() || null,
      createdAt: item.createdAt ?? new Date().toISOString()
    }));
    const hasBothSides = this.hasFrontAndBackCredentialDocuments(sanitizedCredentials);

    const updated = await prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        crefNumber: input.crefNumber.trim(),
        crefDocumentUrl: input.crefDocumentUrl?.trim() ?? null,
        credentialDocuments: sanitizedCredentials,
        crefValidatedAt: null,
        crefValidationStatus: hasBothSides
          ? CREF_STATUS_IN_REVIEW
          : CrefValidationStatus.PENDING,
        crefRejectionReason: null,
        crefReviewedAt: null,
        crefReviewedByUserId: null
      },
      select: {
        id: true,
        crefNumber: true,
        crefDocumentUrl: true,
        credentialDocuments: true,
        crefValidatedAt: true,
        crefValidationStatus: true,
        crefRejectionReason: true,
        crefRejectionCount: true,
        crefReviewedAt: true
      }
    });

    await deleteByPattern("providers:*");
    return this.mapCredentialsPayload(updated);
  }

  async listCrefValidationQueue(status: CrefValidationQueueStatus = "IN_REVIEW", take = 100) {
    const desiredStatus =
      status === "IN_REVIEW"
        ? CREF_STATUS_IN_REVIEW
        : status === "APPROVED"
        ? CrefValidationStatus.APPROVED
        : status === "REJECTED"
          ? CrefValidationStatus.REJECTED
          : CrefValidationStatus.PENDING;

    const providers = await prisma.providerProfile.findMany({
      where: {
        crefNumber: { not: null },
        crefValidationStatus: desiredStatus
      },
      select: {
        id: true,
        userId: true,
        crefNumber: true,
        crefDocumentUrl: true,
        credentialDocuments: true,
        crefValidatedAt: true,
        crefValidationStatus: true,
        crefRejectionReason: true,
        crefRejectionCount: true,
        crefReviewedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: Math.min(Math.max(take, 1), 200)
    });

    return providers
      .map((provider) => ({
        ...this.mapCredentialsPayload(provider),
        user: provider.user,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt
      }));
  }

  async reviewProviderCref(adminUserId: string, providerId: string, input: ReviewProviderCrefInput) {
    await this.assertAdminAccess(adminUserId);

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        userId: true,
        crefNumber: true,
        crefDocumentUrl: true,
        credentialDocuments: true,
        crefValidatedAt: true,
        crefValidationStatus: true,
        crefRejectionReason: true,
        crefReviewedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!provider) {
      throw new AppError("Perfil profissional nao encontrado.", StatusCodes.NOT_FOUND);
    }

    if (!provider.crefNumber?.trim() || !this.hasFrontAndBackCredentialDocuments(provider.credentialDocuments)) {
      throw new AppError(
        "Nao e possivel validar CREF sem frente e verso anexados.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (provider.crefValidationStatus !== CREF_STATUS_IN_REVIEW) {
      throw new AppError(
        "Este CREF nao esta em analise no momento.",
        StatusCodes.BAD_REQUEST
      );
    }

    // Raio-X de pagamentos, Rodada 5, Lote 5 (auditoria adversarial):
    // profissional suspenso ou com CREF rejeitado podia recriar conta com
    // e-mail novo e resubmeter o mesmo número de CREF sem nenhum bloqueio
    // automático — crefNumber não tem @unique, e a revisão nunca cruzava
    // com submissões anteriores (aprovadas, rejeitadas ou suspensas).
    if (input.decision === "APPROVE") {
      const duplicate = await prisma.providerProfile.findFirst({
        where: {
          id: { not: provider.id },
          crefNumber: { equals: provider.crefNumber, mode: "insensitive" },
          OR: [
            { crefValidationStatus: CrefValidationStatus.APPROVED },
            { crefValidationStatus: CrefValidationStatus.REJECTED },
            { user: { suspendedAt: { not: null } } }
          ]
        },
        select: { id: true, userId: true }
      });
      if (duplicate) {
        throw new AppError(
          "Este número de CREF já foi usado em outro perfil (aprovado, rejeitado ou suspenso). Revise manualmente antes de aprovar — pode ser uma tentativa de recriar conta.",
          StatusCodes.CONFLICT
        );
      }
    }

    const decision = input.decision;
    const justification = input.justification?.trim() ?? "";
    if (decision === "REJECT" && !justification) {
      throw new AppError("Informe uma justificativa para reprovar o CREF.", StatusCodes.BAD_REQUEST);
    }

    if (justification.length > 300) {
      throw new AppError("A justificativa deve ter no maximo 300 caracteres.", StatusCodes.BAD_REQUEST);
    }

    const reviewedAt = new Date();
    const approved = decision === "APPROVE";
    const updated = await prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        crefValidatedAt: approved ? reviewedAt : null,
        crefValidationStatus: approved ? CrefValidationStatus.APPROVED : CrefValidationStatus.REJECTED,
        crefRejectionReason: approved ? null : justification,
        // Contador nunca reseta (histórico de vida inteira do perfil) —
        // diferente de crefRejectionReason, que só guarda o motivo da
        // reprovação mais recente e é sobrescrito a cada nova revisão.
        crefRejectionCount: approved ? undefined : { increment: 1 },
        crefReviewedAt: reviewedAt,
        crefReviewedByUserId: adminUserId
      },
      select: {
        id: true,
        userId: true,
        crefNumber: true,
        crefDocumentUrl: true,
        credentialDocuments: true,
        crefValidatedAt: true,
        crefValidationStatus: true,
        crefRejectionReason: true,
        crefRejectionCount: true,
        crefReviewedAt: true,
        user: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    const notificationService = new NotificationService();
    const title = approved ? "CREF aprovado" : "CREF reprovado";
    const body = approved
      ? "Seu CREF foi aprovado pela equipe e seu perfil profissional esta liberado."
      : `Seu CREF foi reprovado. Motivo: ${justification}`;

    void notificationService
      .sendToUsers([updated.userId], {
        preferenceType: "SYSTEM",
        title,
        body,
        data: {
          type: approved ? "CREF_APPROVED" : "CREF_REJECTED",
          providerId,
          decision
        }
      })
      .catch((error) => {
        console.error("Falha ao notificar profissional sobre revisao de CREF:", error);
      });

    if (this.emailService.canSendEmail()) {
      void this.emailService
        .sendCrefReviewEmail({
          to: updated.user.email,
          userName: updated.user.name,
          approved,
          justification: approved ? null : justification
        })
        .catch((error) => {
          console.error("Falha ao enviar e-mail de revisao de CREF:", error);
        });
    }

    void writeAdminAuditLog({
      adminId: adminUserId,
      action: approved ? "CREF_APPROVED" : "CREF_REJECTED",
      targetType: "PROVIDER",
      targetId: provider.id,
      metadata: {
        providerUserId: provider.userId,
        crefNumber: provider.crefNumber,
        justification: approved ? null : justification,
      },
    });

    await deleteByPattern("providers:*");
    return this.mapCredentialsPayload(updated);
  }

  async validateProviderCref(adminUserId: string, providerId: string) {
    return this.reviewProviderCref(adminUserId, providerId, {
      decision: "APPROVE"
    });
  }

  private async assertStudentManagedByProvider(providerId: string, clientId: string) {
    const [booking, contract] = await Promise.all([
      prisma.booking.findFirst({
        where: {
          providerId,
          clientId,
          status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] }
        },
        select: { id: true }
      }),
      prisma.consultancyContract.findFirst({
        where: {
          providerId,
          clientId,
          status: { in: ["PENDING_PAYMENT", "ACTIVE", "DELIVERED"] }
        },
        select: { id: true }
      })
    ]);

    if (!booking && !contract) {
      throw new AppError(
        "Aluno não vinculado aos serviços deste profissional.",
        StatusCodes.NOT_FOUND
      );
    }
  }

  async createProfile(input: CreateProviderInput) {
    const profile = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        include: { providerProfile: true }
      });
      if (!user) {
        throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
      }
      if (user.providerProfile) {
        throw new AppError("Perfil profissional já existe.", StatusCodes.CONFLICT);
      }
      const requestedCategoryIds = input.categoryIds ?? [];
      if (requestedCategoryIds.length > 0) {
        const categories = await tx.serviceCategory.findMany({
          where: { id: { in: requestedCategoryIds } },
          select: { id: true }
        });
        if (categories.length !== requestedCategoryIds.length) {
          throw new AppError("Uma ou mais categorias sao invalidas.", StatusCodes.BAD_REQUEST);
        }
      }
      const specialties = sanitizeSpecialties(input.specialties ?? []);
      const specialtyCategoryIds = await resolveCategoryIdsFromSpecialties(tx, specialties);
      const categoryIds = Array.from(new Set([...requestedCategoryIds, ...specialtyCategoryIds]));
      await tx.user.update({
        where: { id: input.userId },
        data: { role: UserRole.PROVIDER }
      });
      const fixedLocs = (input.fixedLocations ?? []).map((loc) => ({
        id: loc.id ?? randomUUID(),
        name: loc.name.trim(),
        address: loc.address?.trim() ?? null,
        latitude: typeof loc.latitude === "number" ? loc.latitude : null,
        longitude: typeof loc.longitude === "number" ? loc.longitude : null,
        radiusKm: typeof loc.radiusKm === "number" ? Math.max(1, Math.round(loc.radiusKm)) : null
      }));

      return tx.providerProfile.create({
        data: {
          displayName: input.displayName,
          bio: input.bio,
          experienceYears: input.experienceYears,
          priceCents: input.priceCents,
          photoUrl: input.photoUrl,
          presentationVideoUrl: ENABLE_VIDEO_UPLOAD && input.presentationVideoUrl ? input.presentationVideoUrl : undefined,
          serviceRadiusKm: input.serviceRadiusKm,
          latitude: input.latitude,
          longitude: input.longitude,
          serviceMode: input.serviceMode ?? ProviderServiceMode.BOTH,
          fixedLocations: fixedLocs,
          excludedLocations: input.excludedLocations ?? [],
          userId: input.userId,
          specialties,
          categoryLinks: categoryIds.length > 0
            ? { create: categoryIds.map((categoryId) => ({ categoryId })) }
            : undefined
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          },
          categoryLinks: {
            include: {
              category: true
            }
          }
        }
      });
    }).catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError("Perfil profissional já existe.", StatusCodes.CONFLICT);
      }
      throw err;
    });
    await deleteByPattern("providers:*");
    return profile;
  }

  async updateProfile(userId: string, input: UpdateProviderInput) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        specialties: true
      }
    });
    if (!provider) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }

    const fixedLocs = input.fixedLocations
      ? input.fixedLocations.map((loc) => ({
          id: loc.id ?? randomUUID(),
          name: loc.name.trim(),
          address: loc.address?.trim() ?? null,
          latitude: typeof loc.latitude === "number" ? loc.latitude : null,
          longitude: typeof loc.longitude === "number" ? loc.longitude : null,
          radiusKm: typeof loc.radiusKm === "number" ? Math.max(1, Math.round(loc.radiusKm)) : null
        }))
      : undefined;

    const nextSpecialties = input.specialties !== undefined
      ? sanitizeSpecialties(input.specialties)
      : sanitizeSpecialties(
          Array.isArray(provider.specialties)
            ? (provider.specialties as string[])
            : []
        );

    // Regra de produto: categoria segue as especialidades do personal.
    if (input.categoryIds !== undefined || input.specialties !== undefined) {
      const requestedCategoryIds = input.categoryIds ?? [];
      if (requestedCategoryIds.length > 0) {
        const categories = await prisma.serviceCategory.findMany({
          where: { id: { in: requestedCategoryIds } },
          select: { id: true }
        });
        if (categories.length !== requestedCategoryIds.length) {
          throw new AppError("Uma ou mais categorias são inválidas.", StatusCodes.BAD_REQUEST);
        }
      }
      const specialtyCategoryIds = await resolveCategoryIdsFromSpecialties(prisma, nextSpecialties);
      const categoryIds = Array.from(new Set([...requestedCategoryIds, ...specialtyCategoryIds]));
      await prisma.providerCategory.deleteMany({ where: { providerId: provider.id } });
      if (categoryIds.length > 0) {
        await prisma.providerCategory.createMany({
          data: categoryIds.map((categoryId) => ({ providerId: provider.id, categoryId }))
        });
      }
    }

    const updated = await prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.bio !== undefined && { bio: input.bio }),
        ...(input.experienceYears !== undefined && { experienceYears: input.experienceYears }),
        ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
        ...(input.photoUrl !== undefined && { photoUrl: input.photoUrl }),
        ...(ENABLE_VIDEO_UPLOAD && input.presentationVideoUrl !== undefined
          ? { presentationVideoUrl: input.presentationVideoUrl === "" ? null : input.presentationVideoUrl }
          : {}),
        ...(input.serviceRadiusKm !== undefined && { serviceRadiusKm: input.serviceRadiusKm }),
        ...(input.latitude !== undefined && { latitude: input.latitude }),
        ...(input.longitude !== undefined && { longitude: input.longitude }),
        ...(input.serviceMode !== undefined && { serviceMode: input.serviceMode }),
        ...(fixedLocs !== undefined && { fixedLocations: fixedLocs }),
        ...(input.excludedLocations !== undefined && { excludedLocations: input.excludedLocations }),
        ...(input.specialties !== undefined && { specialties: nextSpecialties }),
        ...(input.minBookingNoticeHours !== undefined && { minBookingNoticeHours: input.minBookingNoticeHours }),
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        categoryLinks: { include: { category: true } }
      }
    });

    await deleteByPattern("providers:*");
    return updated;
  }

  async search(input: SearchProvidersInput) {
    const pageOffset =
      typeof input.offset === "number" && Number.isFinite(input.offset)
        ? Math.max(0, Math.min(10000, Math.trunc(input.offset)))
        : 0;
    const pageTake =
      typeof input.take === "number" && Number.isFinite(input.take)
        ? Math.max(1, Math.min(100, Math.trunc(input.take)))
        : 50;

    const { offset: _offset, take: _take, ...filters } = input;
    const hasGeo = typeof filters.lat === "number" && typeof filters.lng === "number";

    // Spatial grid cache: round lat/lng to nearest 0.01° (~1.1 km) so nearby
    // positions share a cache entry.
    const geoGridKey = hasGeo
      ? `${(Math.round(filters.lat! * 100) / 100).toFixed(2)}:${(Math.round(filters.lng! * 100) / 100).toFixed(2)}:${filters.maxDistanceKm ?? "inf"}`
      : null;

    // Normalise non-geo cache key by sorting object keys so property-order
    // differences between callers don't cause unnecessary cache misses.
    const sortedInput = Object.fromEntries(
      Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))
    );
    const baseCacheKey = geoGridKey
      ? `providers:geo:${geoGridKey}:${filters.q ?? ""}:${filters.categoryId ?? ""}:${filters.serviceMode ?? ""}:${filters.minRating ?? ""}`
      : `providers:search:${JSON.stringify(sortedInput)}`;
    const pageCacheKey = `${baseCacheKey}:offset:${pageOffset}:take:${pageTake ?? "all"}`;

    const cachedPage = await getCache<Array<Record<string, unknown>>>(pageCacheKey);
    if (cachedPage) return cachedPage;

    // Bounding-box pre-filter: convert maxDistanceKm to lat/lng deltas and
    // restrict the DB query to a rectangular region before doing haversine.
    // Providers without main coordinates are always included (they may have
    // fixed locations that fall inside the radius — haversine handles them).
    const bboxWhere = (() => {
      if (!hasGeo || !filters.maxDistanceKm) return {};
      const clientLat = filters.lat!;
      const clientLng = filters.lng!;
      // Expand bbox by 200 km to reduce false negatives from providers that rely on
      // fixedLocations (stored as JSON, so we cannot pre-filter those points in SQL).
      const effectiveKm = filters.maxDistanceKm + 200;
      const latDelta = effectiveKm / 111;
      const lngDelta = effectiveKm / (111 * Math.cos((clientLat * Math.PI) / 180));
      return {
        OR: [
          { latitude: null as null },
          { longitude: null as null },
          {
            latitude: { gte: clientLat - latDelta, lte: clientLat + latDelta },
            longitude: { gte: clientLng - lngDelta, lte: clientLng + lngDelta },
          },
        ],
      };
    })();

    const where: Prisma.ProviderProfileWhereInput = {
      crefValidationStatus: CrefValidationStatus.APPROVED,
      mpAccountId: { not: null },
      // Raio-X de pagamentos, Rodada 4, Lote 3: suspensão só bloqueava o
      // próprio login do profissional — ele continuava pesquisável e podia
      // receber novos agendamentos/compras normalmente.
      user: { suspendedAt: null },
      averageRating: filters.minRating ? { gte: filters.minRating } : undefined,
      ...(filters.q ? {
        OR: [
          { displayName: { contains: filters.q, mode: "insensitive" as const } },
          { specialties: { array_contains: [filters.q] } },
        ]
      } : {}),
      categoryLinks: filters.categoryId
        ? { some: { categoryId: filters.categoryId } }
        : undefined,
      serviceMode: filters.serviceMode ? { equals: filters.serviceMode } : undefined,
      ...bboxWhere,
    };

    const toSafeSummary = <
      T extends {
        id: string;
        photoUrl?: string | null;
        presentationVideoUrl?: string | null;
        updatedAt?: Date;
      }
    >(
      provider: T,
      distanceKm?: number
    ) => {
      const { presentationVideoUrl: _v, ...rest } = provider;
      return {
        ...rest,
        ...(typeof distanceKm === "number" ? { distanceKm } : {}),
        photoUrl: toProviderPhotoUrl(rest.id, rest.photoUrl ?? null, rest.updatedAt ?? null),
      };
    };

    if (!hasGeo) {
      const providers = await prisma.providerProfile.findMany({
        where,
        select: {
          ...PUBLIC_PROVIDER_SELECT,
          user: { select: { id: true, name: true } },
          categoryLinks: {
            select: {
              categoryId: true,
              category: { select: { id: true, name: true } }
            }
          },
        },
        orderBy: [{ averageRating: "desc" }, { totalReviews: "desc" }],
        skip: pageOffset,
        ...(pageTake ? { take: pageTake } : {})
      });

      const safeResult = providers.map((provider) => toSafeSummary(provider));
      await setCache(pageCacheKey, safeResult, 180);
      return safeResult;
    }

    const orderedCacheKey = `${baseCacheKey}:ordered`;
    let ordered = await getCache<Array<{
      id: string;
      distanceKm?: number;
      averageRating: number;
      totalReviews: number;
    }>>(orderedCacheKey);

    if (!ordered) {
      const clientLat = filters.lat!;
      const clientLng = filters.lng!;
      const chunkSize = 1000;
      const ranked: Array<{
        id: string;
        distanceKm?: number;
        averageRating: number;
        totalReviews: number;
      }> = [];
      type GeoCandidate = {
        id: string;
        latitude: number | null;
        longitude: number | null;
        fixedLocations: Prisma.JsonValue;
        averageRating: number;
        totalReviews: number;
      };
      type RankedGeoCandidate = {
        id: string;
        distanceKm?: number;
        averageRating: number;
        totalReviews: number;
        hasMainDistance: boolean;
        hasFixedDistance: boolean;
        mainDistance?: number;
        fixedDistances: number[];
      };

      const MAX_GEO_CANDIDATES = 5000;
      let cursorId: string | null = null;
      for (;;) {
        if (ranked.length >= MAX_GEO_CANDIDATES) break;
        const candidates: GeoCandidate[] = await prisma.providerProfile.findMany({
          where,
          select: {
            id: true,
            latitude: true,
            longitude: true,
            fixedLocations: true,
            averageRating: true,
            totalReviews: true
          },
          orderBy: { id: "asc" },
          take: chunkSize,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
        });

        if (candidates.length === 0) {
          break;
        }

        const chunkRanked = candidates
          .map((provider: GeoCandidate): RankedGeoCandidate => {
          const fixedLocations = Array.isArray(provider.fixedLocations)
            ? (provider.fixedLocations as Array<{
                latitude?: number | null;
                longitude?: number | null;
              }>)
            : [];

          const mainDistance =
            provider.latitude == null || provider.longitude == null
              ? undefined
              : haversineKm(clientLat, clientLng, provider.latitude, provider.longitude);
          const fixedDistances = fixedLocations
            .filter(
              (loc) =>
                typeof loc.latitude === "number" && Number.isFinite(loc.latitude) &&
                typeof loc.longitude === "number" && Number.isFinite(loc.longitude)
            )
            .map((loc) => haversineKm(clientLat, clientLng, loc.latitude as number, loc.longitude as number));

          const candidateDistances = [
            ...(typeof mainDistance === "number" ? [mainDistance] : []),
            ...fixedDistances
          ];
          const nearestDistance =
            candidateDistances.length > 0 ? Math.min(...candidateDistances) : undefined;

            return {
            id: provider.id,
            distanceKm:
              typeof nearestDistance === "number"
                ? Math.round(nearestDistance * 10) / 10
                : undefined,
            averageRating: provider.averageRating,
            totalReviews: provider.totalReviews,
            hasMainDistance: typeof mainDistance === "number",
            hasFixedDistance: fixedDistances.length > 0,
            mainDistance,
            fixedDistances
          };
        })
        .filter((provider: RankedGeoCandidate) => {
          const userMaxDistance = filters.maxDistanceKm ?? Number.POSITIVE_INFINITY;
          const hasDistanceLimit = Number.isFinite(userMaxDistance);

          if (!provider.hasMainDistance && !provider.hasFixedDistance) {
            return !hasDistanceLimit;
          }

          const withinMain =
            provider.hasMainDistance &&
            (provider.mainDistance as number) <= userMaxDistance;

          const withinFixed = provider.fixedDistances.some((distance: number) => distance <= userMaxDistance);

          return Boolean(withinMain || withinFixed);
        })
          .map((provider: RankedGeoCandidate) => ({
            id: provider.id,
            distanceKm: provider.distanceKm,
            averageRating: provider.averageRating,
            totalReviews: provider.totalReviews
          }));

        ranked.push(...chunkRanked);
        cursorId = candidates[candidates.length - 1]!.id;
      }

      ordered = ranked.sort((a, b) => {
        const da = a.distanceKm ?? 9999;
        const db = b.distanceKm ?? 9999;
        if (da !== db) return da - db;
        if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
        return b.totalReviews - a.totalReviews;
      });

      await setCache(orderedCacheKey, ordered, 300);
    }

    const pagedOrdered = paginateProviders(ordered, pageOffset, pageTake);
    if (pagedOrdered.length === 0) {
      await setCache(pageCacheKey, [], 300);
      return [];
    }

    const pageIds = pagedOrdered.map((item) => item.id);
    const pageProviders = await prisma.providerProfile.findMany({
      where: { id: { in: pageIds } },
      select: {
        ...PUBLIC_PROVIDER_SELECT,
        user: { select: { id: true, name: true } },
        categoryLinks: {
          select: {
            categoryId: true,
            category: { select: { id: true, name: true } }
          }
        },
      }
    });

    const providerMap = new Map(pageProviders.map((provider) => [provider.id, provider]));
    const distanceMap = new Map(pagedOrdered.map((item) => [item.id, item.distanceKm]));

    const safeResult = pageIds
      .map((providerId) => {
        const provider = providerMap.get(providerId);
        if (!provider) return null;
        return toSafeSummary(provider, distanceMap.get(providerId));
      })
      .filter((provider) => provider !== null) as Array<ReturnType<typeof toSafeSummary>>;

    await setCache(pageCacheKey, safeResult, 300);
    return safeResult;
  }

  async getById(providerId: string) {
    const include = {
      ...PUBLIC_PROVIDER_SELECT,
      user: {
        select: {
          id: true,
          name: true
        }
      },
      categoryLinks: {
        include: { category: true }
      },
      availabilities: {
        where: { isActive: true }
      },
      reviews: {
        include: {
          user: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: "desc" as const },
        take: 10
      }
    };

    let provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: include
    });
    if (!provider) {
      throw new AppError("Prestador não encontrado.", StatusCodes.NOT_FOUND);
    }
    if (!this.isCrefApproved(provider)) {
      throw new AppError("Prestador não encontrado.", StatusCodes.NOT_FOUND);
    }
    const currentProviderId = provider.id;

    const specialties = sanitizeSpecialties(
      Array.isArray(provider.specialties) ? (provider.specialties as string[]) : []
    );

    // Garante que todas as especialidades do personal tenham um vínculo de categoria.
    // Antes, o auto-reparo só rodava quando NÃO havia nenhum vínculo (length === 0),
    // o que deixava especialidades adicionadas depois sem categoria visível para o cliente.
    const linkedCategoryNames = new Set(
      provider.categoryLinks
        .map((link) => normalizeLoose((link as any).category?.name ?? ""))
        .filter(Boolean)
    );
    const missingSpecialties = specialties.filter(
      (s) => !linkedCategoryNames.has(normalizeLoose(s))
    );

    if (missingSpecialties.length > 0) {
      const categoryIds = await resolveCategoryIdsFromSpecialties(prisma, missingSpecialties);
      if (categoryIds.length > 0) {
        await prisma.providerCategory.createMany({
          data: categoryIds.map((categoryId) => ({ providerId: currentProviderId, categoryId })),
          skipDuplicates: true
        });
        const refreshed = await prisma.providerProfile.findUnique({
          where: { id: providerId },
          select: include
        });
        if (refreshed) {
          provider = refreshed;
        }
      }
    }

    // Replace base64 media blobs with streaming paths so the JSON response stays small.
    // Clients reconstruct the full URL by prepending their API base URL.
    return {
      ...provider,
      photoUrl: toProviderPhotoUrl(provider.id, provider.photoUrl, provider.updatedAt),
      presentationVideoUrl:
        ENABLE_VIDEO_UPLOAD && provider.presentationVideoUrl
          ? toProviderVideoUrl(
              provider.id,
              provider.presentationVideoUrl,
              provider.updatedAt
            )
          : null,
    };
  }

  async getPublicSchedulePreview(
    providerId: string,
    input: { startDate?: string; days?: number } = {}
  ) {
    // Validate inputs before any DB/cache access
    const days = Math.min(Math.max(input.days ?? 7, 1), 14);
    const base = input.startDate
      ? new Date(`${input.startDate}T12:00:00.000Z`)
      : new Date();
    if (Number.isNaN(base.getTime())) {
      throw new AppError("Data de início inválida.", StatusCodes.BAD_REQUEST);
    }

    const cacheKey = `schedule:${providerId}:${input.startDate ?? "now"}:${days}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        crefValidationStatus: true,
        minBookingNoticeHours: true,
        availabilities: {
          where: { isActive: true },
          select: {
            weekday: true,
            startTime: true,
            endTime: true,
            isActive: true
          }
        }
      }
    });

    if (!provider || provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
      throw new AppError("Prestador não encontrado.", StatusCodes.NOT_FOUND);
    }

    const timezone = env.APP_TIMEZONE;
    // Mesmo piso de 24h (ou mais, se o profissional configurar) aplicado na
    // criação do agendamento — aqui só pra não exibir como "livre" um horário
    // que a criação real vai recusar por falta de antecedência.
    const minNoticeHours = Math.max(24, provider.minBookingNoticeHours);
    const noticeCutoff = new Date(Date.now() + minNoticeHours * 60 * 60 * 1000);
    const noticeCutoffDateKey = formatDateKeyInTimezone(noticeCutoff, timezone);
    const noticeCutoffTime = formatTimeInTimezone(noticeCutoff, timezone);

    const dayRefs = Array.from({ length: days }, (_, index) => {
      const ref = new Date(base);
      ref.setUTCDate(base.getUTCDate() + index);
      return ref;
    });
    const dayKeys = dayRefs.map((ref) => formatDateKeyInTimezone(ref, timezone));
    const dayKeySet = new Set(dayKeys);

    const bookingWindowStart = new Date(base);
    bookingWindowStart.setUTCDate(base.getUTCDate() - 1);
    bookingWindowStart.setUTCHours(0, 0, 0, 0);

    const bookingWindowEnd = new Date(base);
    bookingWindowEnd.setUTCDate(base.getUTCDate() + days + 1);
    bookingWindowEnd.setUTCHours(23, 59, 59, 999);

    const bookings = await prisma.booking.findMany({
      where: {
        providerId,
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED]
        },
        scheduledAt: {
          gte: bookingWindowStart,
          lte: bookingWindowEnd
        }
      },
      select: {
        scheduledAt: true
      },
      orderBy: {
        scheduledAt: "asc"
      }
    });

    const occupiedByDay = new Map<string, Set<string>>();
    for (const booking of bookings) {
      const dayKey = formatDateKeyInTimezone(booking.scheduledAt, timezone);
      if (!dayKeySet.has(dayKey)) continue;
      const time = formatTimeInTimezone(booking.scheduledAt, timezone);
      const existing = occupiedByDay.get(dayKey) ?? new Set<string>();
      existing.add(time);
      occupiedByDay.set(dayKey, existing);
    }

    const validDayKeys = dayKeys.filter((k): k is string => Boolean(k));
    const manualBlocksInRange = await prisma.providerManualBlock.findMany({
      where: { providerId, date: { in: validDayKeys } },
      select: { date: true, startTime: true, endTime: true },
      take: 1000,
    });

    const blockedByDay = new Map<string, Array<{ startTime: string; endTime: string }>>();
    for (const block of manualBlocksInRange) {
      const existing = blockedByDay.get(block.date) ?? [];
      existing.push({ startTime: block.startTime, endTime: block.endTime });
      blockedByDay.set(block.date, existing);
    }

    // Alunos presenciais cadastrados fora do app (Financeiro) com horario fixo
    // semanal tambem ocupam a agenda publica — sem isso, um cliente do app
    // poderia agendar exatamente no horario de um aluno que so o profissional
    // enxerga no proprio controle financeiro.
    const offAppStudents = await prisma.financialStudent.findMany({
      where: {
        providerId,
        isActive: true,
        type: { in: ["PRESENTIAL", "BOTH"] }
      },
      select: { weeklySchedule: true, startDate: true, recurrenceEndDate: true }
    });
    const offAppByDay = new Map<string, Array<{ startTime: string; endTime: string }>>();
    for (const student of offAppStudents) {
      const schedule = Array.isArray(student.weeklySchedule)
        ? (student.weeklySchedule as unknown as Array<{ dayOfWeek: number; startTime: string; endTime: string }>)
        : [];
      if (schedule.length === 0) continue;
      const startKey = formatDateKeyInTimezone(student.startDate, timezone);
      const endKey = student.recurrenceEndDate ? formatDateKeyInTimezone(student.recurrenceEndDate, timezone) : null;
      for (const dayKey of validDayKeys) {
        if (dayKey < startKey) continue;
        if (endKey && dayKey > endKey) continue;
        const [y, m, d] = dayKey.split("-").map(Number);
        const dayWeekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
        for (const slot of schedule) {
          if (slot.dayOfWeek !== dayWeekday) continue;
          const existing = offAppByDay.get(dayKey) ?? [];
          existing.push({ startTime: slot.startTime, endTime: slot.endTime });
          offAppByDay.set(dayKey, existing);
        }
      }
    }

    const payload = dayRefs.map((ref, index) => {
      const date = dayKeys[index];
      const weekday = weekdayInTimezone(ref, timezone);
      const occupiedSet = occupiedByDay.get(date) ?? new Set<string>();
      const blockRanges = blockedByDay.get(date) ?? [];
      const offAppRanges = offAppByDay.get(date) ?? [];
      const windows = provider.availabilities
        .filter((slot) => slot.weekday === weekday && slot.isActive)
        .map((slot) => ({ startTime: slot.startTime, endTime: slot.endTime }));

      const availableGenerated = new Set<string>();
      for (const window of windows) {
        const start = parseMinutes(window.startTime);
        const end = parseMinutes(window.endTime);
        if (end <= start) continue;
        for (let minute = start; minute < end; minute += 30) {
          availableGenerated.add(formatMinutes(minute));
        }
      }

      const occupiedSlots = Array.from(occupiedSet).sort((a, b) => a.localeCompare(b));
      const availableSlots = Array.from(availableGenerated)
        .filter((slot) => {
          if (occupiedSet.has(slot)) return false;
          if (blockRanges.some((b) => slot >= b.startTime && slot < b.endTime)) return false;
          if (offAppRanges.some((b) => slot >= b.startTime && slot < b.endTime)) return false;
          if (date < noticeCutoffDateKey) return false;
          if (date === noticeCutoffDateKey && slot < noticeCutoffTime) return false;
          return true;
        })
        .sort((a, b) => a.localeCompare(b));

      return {
        date,
        weekday,
        label: new Intl.DateTimeFormat("pt-BR", {
          timeZone: timezone,
          weekday: "short",
          day: "2-digit",
          month: "2-digit"
        }).format(ref),
        availableSlots,
        occupiedSlots
      };
    });

    const result = { providerId, timezone, days: payload };
    await setCache(cacheKey, result, 60);
    return result;
  }

  async listDashboardCalendar(userId: string, range: ProviderCalendarRangeInput) {
    const provider = await this.getProviderByUserId(userId);
    const { from, to } = parseRange(range);

    const [bookings, manualEvents] = await Promise.all([
      prisma.booking.findMany({
        where: {
          providerId: provider.id,
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.COMPLETED]
          },
          scheduledAt: {
            gte: from,
            lte: to
          }
        },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          },
          category: {
            select: {
              id: true,
              name: true
            }
          },
          payment: {
            select: {
              id: true,
              method: true,
              status: true,
              amountCents: true
            }
          }
        },
        orderBy: { scheduledAt: "asc" },
        take: 500,
      }),
      prisma.providerCalendarEvent.findMany({
        where: {
          providerId: provider.id,
          startsAt: { lte: to },
          endsAt: { gte: from }
        },
        orderBy: { startsAt: "asc" },
        take: 300,
      })
    ]);

    const bookingEvents = bookings.map((booking) => {
      const endsAt = new Date(booking.scheduledAt.getTime() + 60 * 60 * 1000);
      return {
        id: `booking:${booking.id}`,
        source: "BOOKING" as const,
        readonly: true,
        title: `${booking.client.name} - ${booking.category.name}`,
        description: `Agendamento ${booking.status.toLowerCase()} via app`,
        startsAt: booking.scheduledAt,
        endsAt,
        booking: {
          id: booking.id,
          status: booking.status,
          client: booking.client,
          category: booking.category,
          payment: booking.payment
        }
      };
    });

    const manualItems = manualEvents.map((event) => ({
      id: event.id,
      source: "MANUAL" as const,
      readonly: false,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt
    }));

    const events = [...bookingEvents, ...manualItems].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
    );

    return {
      period: {
        from,
        to
      },
      events
    };
  }

  async createManualCalendarEvent(userId: string, input: ProviderManualCalendarEventInput) {
    const provider = await this.getProviderByUserId(userId);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
      throw new AppError("Horário do compromisso inválido.", StatusCodes.BAD_REQUEST);
    }

    return prisma.providerCalendarEvent.create({
      data: {
        providerId: provider.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        startsAt,
        endsAt
      }
    });
  }

  async updateManualCalendarEvent(
    userId: string,
    eventId: string,
    input: Partial<ProviderManualCalendarEventInput>
  ) {
    const provider = await this.getProviderByUserId(userId);

    const event = await prisma.providerCalendarEvent.findUnique({
      where: { id: eventId }
    });

    if (!event || event.providerId !== provider.id) {
      throw new AppError("Compromisso manual não encontrado.", StatusCodes.NOT_FOUND);
    }

    const startsAt = typeof input.startsAt === "undefined" ? event.startsAt : new Date(input.startsAt);
    const endsAt = typeof input.endsAt === "undefined" ? event.endsAt : new Date(input.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
      throw new AppError("Horário do compromisso inválido.", StatusCodes.BAD_REQUEST);
    }

    return prisma.providerCalendarEvent.update({
      where: { id: eventId },
      data: {
        title: typeof input.title === "undefined" ? undefined : input.title.trim(),
        description: typeof input.description === "undefined" ? undefined : input.description?.trim() || null,
        startsAt,
        endsAt
      }
    });
  }

  async deleteManualCalendarEvent(userId: string, eventId: string) {
    const provider = await this.getProviderByUserId(userId);

    const event = await prisma.providerCalendarEvent.findUnique({
      where: { id: eventId }
    });

    if (!event || event.providerId !== provider.id) {
      throw new AppError("Compromisso manual não encontrado.", StatusCodes.NOT_FOUND);
    }

    await prisma.providerCalendarEvent.delete({
      where: { id: eventId }
    });
  }

  async listStudentsByService(userId: string) {
    const provider = await this.getProviderByUserId(userId);
    const now = new Date();

    const clientSelect = {
      id: true,
      name: true,
      email: true,
      phone: true,
      photoUrl: true,
      updatedAt: true,
      anamnesisProfile: {
        select: {
          status: true,
          answers: true
        }
      }
    } as const;

    const [bookings, contracts, activePackages] = await Promise.all([
      prisma.booking.findMany({
        where: {
          providerId: provider.id,
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.COMPLETED]
          }
        },
        include: {
          client: { select: clientSelect }
        },
        orderBy: { scheduledAt: "desc" },
        take: 1000,
      }),
      prisma.consultancyContract.findMany({
        where: {
          providerId: provider.id,
          // AUTHORIZED entra aqui também: o personal precisa ver o aluno como
          // ativo mesmo antes da captura (que só acontece na entrega).
          paymentStatus: { in: [ConsultancyPaymentStatus.AUTHORIZED, ConsultancyPaymentStatus.CAPTURED] },
          status: {
            in: [ConsultancyContractStatus.ACTIVE, ConsultancyContractStatus.DELIVERED]
          }
        },
        include: {
          client: { select: clientSelect },
          offer: {
            select: {
              kind: true,
              title: true,
              billingCycle: true
            }
          },
          _count: {
            select: { trainingPlans: true }
          },
          trainingPlans: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { validUntil: true }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      // Pacote presencial cobra em ciclos, nao por sessao - o "preco" do
      // servico presencial pra esses clientes vem daqui (cycleAmountCents),
      // nunca do priceCents=0 dos bookings gerados pelo pacote.
      prisma.presentialPackage.findMany({
        where: {
          providerId: provider.id,
          status: { in: [PresentialPackageStatus.ACTIVE, PresentialPackageStatus.PAST_DUE] }
        },
        include: { client: { select: clientSelect } },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
    ]);

    type ClientRow = (typeof bookings)[number]["client"];

    type ServiceEntry = {
      serviceKind: ServiceOfferKind | "PRESENTIAL";
      serviceLabel: string;
      valueCents: number;
      active: boolean;
      nextSessionAt: Date | null;
      validUntil: Date | null;
    };

    type StudentAggregate = {
      clientId: string;
      name: string;
      email: string;
      phone: string | null;
      profilePhotoUrl: string | null;
      age: number | null;
      anamnesisPending: boolean;
      trainingPlanPending: boolean;
      fichaRenewalPending: boolean;
      fichaValidUntil: Date | null;
      services: Map<string, ServiceEntry>;
      totalBookings: number;
      totalContracts: number;
      lastActivityAt: Date;
    };

    const students = new Map<string, StudentAggregate>();

    const getStudent = (client: ClientRow, activityAt: Date) => {
      let student = students.get(client.id);
      if (!student) {
        student = {
          clientId: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          profilePhotoUrl: toUserPhotoUrl(client.id, client.photoUrl, client.updatedAt),
          age: parseStudentAgeFromAnamnesis(client.anamnesisProfile?.answers),
          anamnesisPending: client.anamnesisProfile?.status !== AnamnesisStatus.COMPLETED,
          trainingPlanPending: false,
          fichaRenewalPending: false,
          fichaValidUntil: null,
          services: new Map(),
          totalBookings: 0,
          totalContracts: 0,
          lastActivityAt: activityAt
        };
        students.set(client.id, student);
      } else if (student.age == null) {
        const age = parseStudentAgeFromAnamnesis(client.anamnesisProfile?.answers);
        if (age != null) student.age = age;
      }
      if (activityAt > student.lastActivityAt) {
        student.lastActivityAt = activityAt;
      }
      return student;
    };

    const presentialLatest = new Map<string, { priceCents: number; at: Date }>();
    const presentialNextSession = new Map<string, Date>();

    for (const booking of bookings) {
      const student = getStudent(booking.client, booking.scheduledAt);
      student.totalBookings += 1;

      // Sessao gerada por pacote presencial tem priceCents=0 (ja foi paga
      // no ciclo) - nao usa esse valor como "preco" do servico presencial,
      // senao o preco mostrado cairia pra 0 sempre que a sessao mais recente
      // do cliente for uma sessao de pacote. O valor real vem do pacote
      // (loop de activePackages, abaixo).
      const price = !booking.packageId && Number.isFinite(booking.priceCents) ? booking.priceCents : null;
      if (price != null) {
        const latest = presentialLatest.get(booking.client.id);
        if (!latest || booking.scheduledAt > latest.at) {
          presentialLatest.set(booking.client.id, { priceCents: price, at: booking.scheduledAt });
        }
      }

      if (
        booking.scheduledAt > now &&
        (booking.status === BookingStatus.PENDING || booking.status === BookingStatus.CONFIRMED)
      ) {
        const existingNext = presentialNextSession.get(booking.client.id);
        if (!existingNext || booking.scheduledAt < existingNext) {
          presentialNextSession.set(booking.client.id, booking.scheduledAt);
        }
      }
    }

    for (const [clientId, latest] of presentialLatest) {
      const student = students.get(clientId);
      if (!student) continue;
      const recentMs = now.getTime() - student.lastActivityAt.getTime();
      student.services.set("PRESENTIAL", {
        serviceKind: "PRESENTIAL",
        serviceLabel: serviceKindLabel("PRESENTIAL"),
        valueCents: latest.priceCents,
        active: recentMs < 60 * 24 * 60 * 60 * 1000,
        nextSessionAt: presentialNextSession.get(clientId) ?? null,
        validUntil: null
      });
    }

    // Pacote presencial ativo sobrescreve o "preco" derivado de sessao
    // avulsa (acima) - representa melhor a relacao atual com o cliente do
    // que uma sessao antiga isolada, e cobre o caso de cliente cujo unico
    // vinculo e um pacote (sem nenhum Booking ainda, ex: creditos nao
    // usados) que hoje simplesmente nao apareceria na lista.
    const seenPackageClient = new Set<string>();
    for (const pkg of activePackages) {
      if (seenPackageClient.has(pkg.clientId)) continue; // so 1 pacote presencial ativo por vez, por design
      seenPackageClient.add(pkg.clientId);

      const student = getStudent(pkg.client, pkg.createdAt);
      student.services.set("PRESENTIAL", {
        serviceKind: "PRESENTIAL",
        serviceLabel: serviceKindLabel("PRESENTIAL"),
        valueCents: pkg.cycleAmountCents,
        active: pkg.status === PresentialPackageStatus.ACTIVE,
        nextSessionAt: presentialNextSession.get(pkg.clientId) ?? null,
        validUntil: pkg.validUntil
      });
    }

    for (const contract of contracts) {
      const student = getStudent(contract.client, contract.createdAt);
      student.totalContracts += 1;

      const kind = contract.offer.kind;
      const validUntil = consultancyValidUntil(contract, contract.offer.billingCycle);
      const isVigente = validUntil >= now;
      const price = Number.isFinite(contract.paymentAmountCents) ? contract.paymentAmountCents : 0;

      const existing = student.services.get(kind);
      if (!existing) {
        student.services.set(kind, {
          serviceKind: kind,
          serviceLabel: serviceKindLabel(kind),
          valueCents: isVigente ? price : 0,
          active: isVigente,
          nextSessionAt: null,
          validUntil
        });
      } else {
        if (isVigente) {
          existing.valueCents += price;
          existing.active = true;
        }
        if (!existing.validUntil || validUntil > existing.validUntil) {
          existing.validUntil = validUntil;
        }
      }

      if (
        isVigente &&
        contract.status === ConsultancyContractStatus.ACTIVE &&
        contract._count.trainingPlans === 0 &&
        kind !== ServiceOfferKind.PRESENTIAL
      ) {
        student.trainingPlanPending = true;
      }

      // Frente B (liberdade de ofertas): ficha da consultoria vencendo em
      // breve (proximos 3 dias) ou ja vencida - mesma janela usada no job
      // de lembretes (sendFichaExpiryReminders). So considera a ficha MAIS
      // RECENTE do contrato (trainingPlans[0], ja ordenada desc).
      const latestPlanValidUntil = contract.trainingPlans[0]?.validUntil ?? null;
      if (
        contract.status === ConsultancyContractStatus.DELIVERED &&
        latestPlanValidUntil &&
        latestPlanValidUntil.getTime() - now.getTime() <= 3 * 24 * 60 * 60 * 1000
      ) {
        student.fichaRenewalPending = true;
        if (!student.fichaValidUntil || latestPlanValidUntil < student.fichaValidUntil) {
          student.fichaValidUntil = latestPlanValidUntil;
        }
      }
    }

    const result = Array.from(students.values())
      .map((student) => {
        const services = Array.from(student.services.values());
        const totalValueCents = services.reduce(
          (sum, service) =>
            sum + (service.serviceKind === "PRESENTIAL" ? service.valueCents : service.active ? service.valueCents : 0),
          0
        );
        return {
          clientId: student.clientId,
          name: student.name,
          email: student.email,
          phone: student.phone,
          profilePhotoUrl: student.profilePhotoUrl,
          age: student.age,
          anamnesisPending: student.anamnesisPending,
          trainingPlanPending: student.trainingPlanPending,
          fichaRenewalPending: student.fichaRenewalPending,
          fichaValidUntil: student.fichaValidUntil,
          active: services.some((service) => service.active),
          totalValueCents,
          services,
          totalBookings: student.totalBookings,
          totalContracts: student.totalContracts,
          lastActivityAt: student.lastActivityAt
        };
      })
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

    const hasKind = (kind: ServiceOfferKind | "PRESENTIAL") =>
      result.filter((student) => student.services.some((service) => service.serviceKind === kind)).length;

    return {
      providerId: provider.id,
      totalStudents: result.length,
      serviceCounts: {
        ALL: result.length,
        PRESENTIAL: hasKind("PRESENTIAL"),
        ONLINE_CONSULTANCY: hasKind(ServiceOfferKind.ONLINE_CONSULTANCY),
        ONLINE_CONSULTANCY_SPECIALIZED: hasKind(ServiceOfferKind.ONLINE_CONSULTANCY_SPECIALIZED),
        COMBO: hasKind(ServiceOfferKind.COMBO)
      },
      students: result
    };
  }

  async getStudentManagementDetail(userId: string, clientId: string) {
    const provider = await this.getProviderByUserId(userId);
    await this.assertStudentManagedByProvider(provider.id, clientId);

    const [client, anamnesis, physicalAssessment, bookings, contracts, trainingCompletions, presentialPackages] = await Promise.all([
      prisma.user.findUnique({
        where: { id: clientId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          photoUrl: true,
          updatedAt: true,
          createdAt: true
        }
      }),
      prisma.clientAnamnesis.findUnique({
        where: { clientId }
      }),
      prisma.providerStudentAssessment.findUnique({
        where: {
          providerId_clientId: {
            providerId: provider.id,
            clientId
          }
        }
      }),
      prisma.booking.findMany({
        where: {
          providerId: provider.id,
          clientId,
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.COMPLETED]
          }
        },
        include: {
          category: {
            select: {
              id: true,
              name: true
            }
          },
          payment: {
            select: {
              method: true,
              status: true,
              amountCents: true
            }
          },
          completionEvidences: {
            select: {
              id: true,
              mimeType: true,
              cameraFacing: true,
              capturedAt: true,
              userId: true
            },
            orderBy: { capturedAt: "desc" }
          }
        },
        orderBy: { scheduledAt: "desc" },
        take: 100,
      }),
      prisma.consultancyContract.findMany({
        where: {
          providerId: provider.id,
          clientId
        },
        include: {
          offer: {
            select: {
              id: true,
              kind: true,
              title: true,
              billingCycle: true,
              priceCents: true
            }
          },
          request: {
            select: {
              id: true,
              trainingNeedText: true,
              limitationText: true,
              extraInfoText: true,
              providerResponseText: true,
              createdAt: true,
              respondedAt: true
            }
          },
          trainingPlans: {
            where: { isActive: true },
            select: {
              id: true,
              title: true,
              description: true,
              validUntil: true,
              createdAt: true,
              _count: {
                select: {
                  exercises: true,
                  completions: true
                }
              }
            },
            orderBy: { createdAt: "desc" }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.trainingPlanCompletion.findMany({
        where: {
          providerId: provider.id,
          clientId
        },
        include: {
          trainingPlan: {
            select: {
              id: true,
              title: true
            }
          }
        },
        orderBy: { completedAt: "desc" },
        take: 50
      }),
      // Historico de cobranca do pacote presencial - as sessoes (bookings,
      // acima) tem priceCents=0, entao sem isso o dinheiro que o aluno
      // efetivamente pagou nao aparece em lugar nenhum desta tela.
      prisma.presentialPackage.findMany({
        where: { providerId: provider.id, clientId },
        include: {
          offer: { select: { title: true } },
          cycles: { orderBy: { cycleIndex: "desc" }, take: 24 }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);

    if (!client) {
      throw new AppError("Aluno não encontrado.", StatusCodes.NOT_FOUND);
    }

    const serviceCounters = {
      PRESENTIAL: bookings.length,
      ONLINE_CONSULTANCY: contracts.filter((item) => item.offer.kind === ServiceOfferKind.ONLINE_CONSULTANCY).length,
      ONLINE_CONSULTANCY_SPECIALIZED: contracts.filter((item) => item.offer.kind === ServiceOfferKind.ONLINE_CONSULTANCY_SPECIALIZED).length,
      COMBO: contracts.filter((item) => item.offer.kind === ServiceOfferKind.COMBO).length
    };

    const now = new Date();
    const contractsWithValidity = contracts.map((contract) => {
      const isCaptured =
        (contract.paymentStatus === ConsultancyPaymentStatus.AUTHORIZED ||
          contract.paymentStatus === ConsultancyPaymentStatus.CAPTURED) &&
        (contract.status === ConsultancyContractStatus.ACTIVE || contract.status === ConsultancyContractStatus.DELIVERED);
      const validUntil = isCaptured ? consultancyValidUntil(contract, contract.offer.billingCycle) : null;
      return {
        ...contract,
        validUntil,
        isVigente: Boolean(validUntil && validUntil >= now),
        trainingPlans: contract.trainingPlans.map((plan) => {
          const planValidUntil = plan.validUntil ?? validUntil;
          return {
            ...plan,
            validUntil: planValidUntil,
            isVigente: Boolean(planValidUntil && planValidUntil >= now)
          };
        })
      };
    });

    return {
      student: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        profilePhotoUrl: toUserPhotoUrl(client.id, client.photoUrl, client.updatedAt),
        memberSince: client.createdAt
      },
      anamnesis: anamnesis ?? {
        id: null,
        status: "DRAFT",
        completedAt: null,
        answers: null
      },
      physicalAssessment:
        physicalAssessment ?? {
          id: null,
          providerId: provider.id,
          clientId,
          weight: null,
          height: null,
          imc: null,
          bodyFatPercent: null,
          muscleMass: null,
          circumferences: null,
          waist: null,
          hip: null,
          chest: null,
          arm: null,
          thigh: null,
          createdAt: null,
          updatedAt: null
        },
      serviceSummary: {
        presentialBookings: serviceCounters.PRESENTIAL,
        onlineConsultancyContracts: serviceCounters.ONLINE_CONSULTANCY,
        specializedConsultancyContracts: serviceCounters.ONLINE_CONSULTANCY_SPECIALIZED,
        comboContracts: serviceCounters.COMBO
      },
      presentialHistory: bookings,
      presentialPackages,
      consultancyContracts: contractsWithValidity,
      trainingCompliance: {
        completionCount: trainingCompletions.length,
        latestCompletions: trainingCompletions
      }
    };
  }

  async upsertStudentPhysicalAssessment(
    userId: string,
    clientId: string,
    input: UpsertStudentPhysicalAssessmentInput
  ) {
    const provider = await this.getProviderByUserId(userId);
    await this.assertStudentManagedByProvider(provider.id, clientId);

    const normalize = (value?: string) => {
      const next = value?.trim();
      return next ? next : null;
    };

    return prisma.providerStudentAssessment.upsert({
      where: {
        providerId_clientId: {
          providerId: provider.id,
          clientId
        }
      },
      update: {
        weight: normalize(input.weight),
        height: normalize(input.height),
        imc: normalize(input.imc),
        bodyFatPercent: normalize(input.bodyFatPercent),
        muscleMass: normalize(input.muscleMass),
        circumferences: normalize(input.circumferences),
        waist: normalize(input.waist),
        hip: normalize(input.hip),
        chest: normalize(input.chest),
        arm: normalize(input.arm),
        thigh: normalize(input.thigh)
      },
      create: {
        providerId: provider.id,
        clientId,
        weight: normalize(input.weight),
        height: normalize(input.height),
        imc: normalize(input.imc),
        bodyFatPercent: normalize(input.bodyFatPercent),
        muscleMass: normalize(input.muscleMass),
        circumferences: normalize(input.circumferences),
        waist: normalize(input.waist),
        hip: normalize(input.hip),
        chest: normalize(input.chest),
        arm: normalize(input.arm),
        thigh: normalize(input.thigh)
      }
    });
  }

  private static readonly ALLOWED_PHOTO_MIMES = new Set([
    "image/jpeg", "image/jpg", "image/png", "image/webp"
  ]);
  private static readonly ALLOWED_VIDEO_MIMES = new Set([
    "video/mp4", "video/quicktime", "video/webm", "video/3gpp"
  ]);
  private static readonly MAX_PHOTO_BYTES = 8 * 1024 * 1024;  // 8 MB
  private static readonly MAX_VIDEO_BYTES = 40 * 1024 * 1024; // 40 MB

  private static checkMagicBytes(buffer: Buffer, mimeType: string): boolean {
    if (buffer.length < 4) return false;
    switch (mimeType) {
      case "image/jpeg":
      case "image/jpg":
        return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
      case "image/png":
        return buffer[0] === 0x89 && buffer[1] === 0x50 &&
               buffer[2] === 0x4E && buffer[3] === 0x47;
      case "image/webp":
        return buffer.length >= 12 &&
               buffer[0] === 0x52 && buffer[1] === 0x49 &&
               buffer[2] === 0x46 && buffer[3] === 0x46 &&
               buffer[8] === 0x57 && buffer[9] === 0x45 &&
               buffer[10] === 0x42 && buffer[11] === 0x50;
      case "video/mp4":
      case "video/quicktime":
      case "video/3gpp":
        return buffer.length >= 8 &&
               buffer[4] === 0x66 && buffer[5] === 0x74 &&
               buffer[6] === 0x79 && buffer[7] === 0x70;
      case "video/webm":
        return buffer[0] === 0x1A && buffer[1] === 0x45 &&
               buffer[2] === 0xDF && buffer[3] === 0xA3;
      default:
        return false;
    }
  }

  /**
   * Returns the raw photo buffer and mime type for a provider's profile photo.
   * Only handles data:image/ base64 URIs stored in the database.
   */
  async getPhotoById(providerId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const row = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { photoUrl: true },
    });
    if (!row) throw new AppError("Prestador não encontrado.", StatusCodes.NOT_FOUND);

    const url = row.photoUrl ?? "";
    const match = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
    if (!match) throw new AppError("Foto não disponível.", StatusCodes.NOT_FOUND);

    const mimeType = match[1]!;
    if (!ProviderService.ALLOWED_PHOTO_MIMES.has(mimeType)) {
      throw new AppError("Foto não disponível.", StatusCodes.NOT_FOUND);
    }

    const buffer = Buffer.from(match[2]!, "base64");
    if (!ProviderService.checkMagicBytes(buffer, mimeType)) {
      throw new AppError("Foto inválida ou corrompida.", StatusCodes.BAD_REQUEST);
    }
    if (buffer.length > ProviderService.MAX_PHOTO_BYTES) {
      throw new AppError("Foto excede o tamanho máximo permitido.", StatusCodes.BAD_REQUEST);
    }

    return { buffer, mimeType };
  }

  /**
   * Returns the raw video buffer and mime type for a provider's presentation video.
   * Only handles data:video/ base64 URIs stored in the database.
   * Throws AppError(404) when there is no video.
   */
  async getVideoById(providerId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!ENABLE_VIDEO_UPLOAD) {
      throw new AppError("Vídeo não disponível.", StatusCodes.NOT_FOUND);
    }

    const row = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { presentationVideoUrl: true },
    });
    if (!row) throw new AppError("Prestador não encontrado.", StatusCodes.NOT_FOUND);

    const url = row.presentationVideoUrl ?? "";
    const match = url.match(/^data:(video\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
    if (!match) throw new AppError("Vídeo não disponível.", StatusCodes.NOT_FOUND);

    const mimeType = match[1]!;
    if (!ProviderService.ALLOWED_VIDEO_MIMES.has(mimeType)) {
      throw new AppError("Vídeo não disponível.", StatusCodes.NOT_FOUND);
    }

    const buffer = Buffer.from(match[2]!, "base64");
    if (!ProviderService.checkMagicBytes(buffer, mimeType)) {
      throw new AppError("Vídeo inválido ou corrompido.", StatusCodes.BAD_REQUEST);
    }
    if (buffer.length > ProviderService.MAX_VIDEO_BYTES) {
      throw new AppError("Vídeo excede o tamanho máximo permitido.", StatusCodes.BAD_REQUEST);
    }

    return { buffer, mimeType };
  }

  async getStudentAnamnesis(providerUserId: string, clientId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: providerUserId },
      select: { id: true },
    });
    if (!provider) throw new AppError("Perfil de prestador não encontrado.", StatusCodes.NOT_FOUND);

    // Only allow access if the client has at least one booking with this provider
    const hasRelationship = await prisma.booking.findFirst({
      where: {
        providerId: provider.id,
        clientId,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
      },
      select: { id: true },
    });
    if (!hasRelationship) {
      throw new AppError("Você não tem acesso à ficha deste aluno.", StatusCodes.FORBIDDEN);
    }

    const anamnesis = await prisma.clientAnamnesis.findUnique({
      where: { clientId },
      select: {
        id: true,
        status: true,
        answers: true,
        completedAt: true,
        updatedAt: true,
        client: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!anamnesis) {
      return { status: "NONE", answers: null, client: null };
    }

    return anamnesis;
  }

  async getTimeline(providerUserId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: providerUserId },
      select: { id: true },
    });
    if (!provider) throw new AppError("Perfil de prestador não encontrado.", StatusCodes.NOT_FOUND);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const nextHours = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const last48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const [recentBookings, todayBookings, upcomingBookings, allActiveBookings] = await Promise.all([
      // Newly created bookings (last 48h)
      prisma.booking.findMany({
        where: {
          providerId: provider.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          createdAt: { gte: last48h },
        },
        include: {
          client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
          category: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      // Today's bookings
      prisma.booking.findMany({
        where: {
          providerId: provider.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledAt: { gte: todayStart, lte: todayEnd },
        },
        include: {
          client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
          category: { select: { name: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take: 100,
      }),
      // Bookings in the next 3 hours
      prisma.booking.findMany({
        where: {
          providerId: provider.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledAt: { gte: now, lte: nextHours },
        },
        include: {
          client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
          category: { select: { name: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take: 50,
      }),
      // All active client IDs for anamnesis check
      prisma.booking.findMany({
        where: {
          providerId: provider.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        },
        select: { clientId: true },
        distinct: ["clientId"],
        take: 1000,
      }),
    ]);

    // Check anamnesis status of active clients
    const activeClientIds = [...new Set(allActiveBookings.map((b) => b.clientId))];
    const anamnesisRecords = activeClientIds.length > 0
      ? await prisma.clientAnamnesis.findMany({
          where: { clientId: { in: activeClientIds } },
          select: { clientId: true, status: true },
        })
      : [];

    const anamnesisMap = new Map(anamnesisRecords.map((a) => [a.clientId, a.status]));

    const studentsWithIncompleteAnamnesis = activeClientIds.filter((id) => {
      const status = anamnesisMap.get(id);
      return !status || status === "DRAFT";
    });

    const studentsDetails = studentsWithIncompleteAnamnesis.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: studentsWithIncompleteAnamnesis } },
          select: { id: true, name: true, photoUrl: true, updatedAt: true },
        })
      : [];

    const normalizeBookings = <T extends { client: { id: string; photoUrl: string | null; updatedAt: Date } }>(
      items: T[]
    ) =>
      items.map((item) => ({
        ...item,
        client: {
          ...item.client,
          photoUrl: toUserPhotoUrl(item.client.id, item.client.photoUrl, item.client.updatedAt)
        }
      }));

    return {
      upcomingNow: normalizeBookings(upcomingBookings),
      today: normalizeBookings(todayBookings),
      recentNew: normalizeBookings(recentBookings),
      studentsWithIncompleteAnamnesis: studentsDetails.map((student) => ({
        ...student,
        photoUrl: toUserPhotoUrl(student.id, student.photoUrl, student.updatedAt)
      })),
      generatedAt: now.toISOString(),
    };
  }
}
