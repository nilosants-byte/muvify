import { ConsultancyContractStatus, ExerciseMediaType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { ENABLE_VIDEO_UPLOAD } from "../../../config/features";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";

type CreateExerciseInput = {
  providerId: string;
  name: string;
  category: string;
  description?: string;
  defaultRepetitionsSets?: string;
  defaultRestLabel?: string;
  mediaUrl?: string;
  mediaType?: ExerciseMediaType;
};

type ListExercisesInput = {
  userId: string;
  category?: string;
  q?: string;
  includePrebuilt?: boolean;
};

/** Remove mediaUrl de exercícios do tipo VIDEO quando upload está desabilitado. */
function stripVideoMedia<T extends { mediaType?: ExerciseMediaType | null; mediaUrl?: string | null }>(
  exercises: T[]
): T[] {
  if (ENABLE_VIDEO_UPLOAD) return exercises;
  return exercises.map((ex) =>
    ex.mediaType === ExerciseMediaType.VIDEO ? { ...ex, mediaUrl: null } : ex
  );
}

export class ExerciseService {
  async list({ userId, category, q, includePrebuilt = true }: ListExercisesInput) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true }
    });

    const ownerFilter = provider ? [{ providerId: provider.id }] : [];
    const visibilityFilter = [
      ...ownerFilter,
      ...(includePrebuilt ? [{ isPrebuilt: true }] : [])
    ];

    if (visibilityFilter.length === 0) {
      return [];
    }

    const exercises = await prisma.exercise.findMany({
      where: {
        OR: visibilityFilter,
        ...(category ? { category } : {}),
        ...(q ? {
          name: { contains: q, mode: "insensitive" as const }
        } : {})
      },
      orderBy: [{ isPrebuilt: "asc" }, { name: "asc" }],
      take: 500,
    });
    return stripVideoMedia(exercises);
  }

  async listPrebuilt(category?: string, q?: string) {
    const exercises = await prisma.exercise.findMany({
      where: {
        isPrebuilt: true,
        ...(category ? { category } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {})
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 500,
    });
    return stripVideoMedia(exercises);
  }

  async listMine(providerId: string, category?: string, q?: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: providerId },
      select: { id: true }
    });

    if (!provider) {
      return [];
    }

    const exercises = await prisma.exercise.findMany({
      where: {
        providerId: provider.id,
        isPrebuilt: false,
        ...(category ? { category } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {})
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 500,
    });
    return stripVideoMedia(exercises);
  }

  async create(input: CreateExerciseInput) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: input.providerId }
    });
    if (!provider) {
      throw new AppError("Perfil profissional não encontrado. Crie seu perfil antes de adicionar exercícios.", StatusCodes.NOT_FOUND);
    }

    const isVideoMedia = input.mediaType === ExerciseMediaType.VIDEO;

    return prisma.exercise.create({
      data: {
        providerId: provider.id,
        name: input.name.trim(),
        category: input.category.trim(),
        description: input.description?.trim() || null,
        defaultRepetitionsSets: input.defaultRepetitionsSets?.trim() || null,
        defaultRestLabel: input.defaultRestLabel?.trim() || null,
        mediaUrl: (ENABLE_VIDEO_UPLOAD || !isVideoMedia) ? (input.mediaUrl || null) : null,
        mediaType: (ENABLE_VIDEO_UPLOAD || !isVideoMedia) ? (input.mediaType || null) : null,
        isPrebuilt: false
      }
    });
  }

  async createPrebuilt(adminId: string, input: {
    name: string;
    category: string;
    description?: string;
    defaultRepetitionsSets?: string;
    defaultRestLabel?: string;
    mediaUrl?: string;
    mediaType?: ExerciseMediaType;
  }) {
    const created = await prisma.exercise.create({
      data: {
        providerId: null,
        name: input.name.trim(),
        category: input.category.trim(),
        description: input.description?.trim() || null,
        defaultRepetitionsSets: input.defaultRepetitionsSets?.trim() || null,
        defaultRestLabel: input.defaultRestLabel?.trim() || null,
        mediaUrl: input.mediaUrl?.trim() || null,
        mediaType: input.mediaType || null,
        isPrebuilt: true,
      },
    });

    // Raio-X de pagamentos, Rodada 3, Lote 6: unica acao admin sensivel
    // (afeta o catalogo visto por todos os profissionais) sem audit log.
    void writeAdminAuditLog({
      adminId,
      action: "EXERCISE_PREBUILT_CREATED",
      targetType: "EXERCISE",
      targetId: created.id,
      metadata: { name: created.name, category: created.category }
    });

    return created;
  }

  async updatePrebuilt(adminId: string, exerciseId: string, input: {
    name?: string;
    category?: string;
    description?: string;
    defaultRepetitionsSets?: string;
    defaultRestLabel?: string;
    mediaUrl?: string;
    mediaType?: ExerciseMediaType;
  }) {
    const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) throw new AppError("Exercício não encontrado.", StatusCodes.NOT_FOUND);
    if (!exercise.isPrebuilt) throw new AppError("Exercício não é pré-montado.", StatusCodes.BAD_REQUEST);

    const updated = await prisma.exercise.update({
      where: { id: exerciseId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.defaultRepetitionsSets !== undefined ? { defaultRepetitionsSets: input.defaultRepetitionsSets.trim() || null } : {}),
        ...(input.defaultRestLabel !== undefined ? { defaultRestLabel: input.defaultRestLabel.trim() || null } : {}),
        ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl.trim() || null } : {}),
        ...(input.mediaType !== undefined ? { mediaType: input.mediaType || null } : {}),
      },
    });

    void writeAdminAuditLog({
      adminId,
      action: "EXERCISE_PREBUILT_UPDATED",
      targetType: "EXERCISE",
      targetId: exerciseId
    });

    return updated;
  }

  async deletePrebuilt(adminId: string, exerciseId: string) {
    const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) throw new AppError("Exercício não encontrado.", StatusCodes.NOT_FOUND);
    if (!exercise.isPrebuilt) throw new AppError("Exercício não é pré-montado.", StatusCodes.BAD_REQUEST);
    await prisma.exercise.delete({ where: { id: exerciseId } });

    void writeAdminAuditLog({
      adminId,
      action: "EXERCISE_PREBUILT_DELETED",
      targetType: "EXERCISE",
      targetId: exerciseId,
      metadata: { name: exercise.name, category: exercise.category }
    });
  }

  async delete(exerciseId: string, providerId: string) {
    const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) throw new AppError("Exercício não encontrado.", StatusCodes.NOT_FOUND);

    const provider = await prisma.providerProfile.findUnique({ where: { userId: providerId } });
    if (!provider || exercise.providerId !== provider.id) {
      throw new AppError("Você não tem permissão para remover este exercício.", StatusCodes.FORBIDDEN);
    }
    if (exercise.isPrebuilt) {
      throw new AppError("Exercícios da biblioteca Muvify não podem ser removidos.", StatusCodes.FORBIDDEN);
    }

    // Frente 4 (Criação/entrega/evolução do treino), Lote 4: excluir um
    // exercício em uso apagava silenciosamente o conteúdo de fichas ativas
    // de alunos (a FK usa onDelete: SetNull) — sem aviso nenhum ao
    // profissional de que aquilo afetaria alguém que já está treinando.
    const activeUsages = await prisma.trainingPlanExercise.findMany({
      where: {
        exerciseId,
        trainingPlan: {
          isActive: true,
          contract: { status: { in: [ConsultancyContractStatus.ACTIVE, ConsultancyContractStatus.DELIVERED] } }
        }
      },
      select: { trainingPlanId: true },
      distinct: ["trainingPlanId"]
    });
    if (activeUsages.length > 0) {
      throw new AppError(
        `Este exercício está em uso em ${activeUsages.length} ficha(s) ativa(s) de aluno(s) e não pode ser removido.`,
        StatusCodes.CONFLICT
      );
    }

    await prisma.exercise.delete({ where: { id: exerciseId } });
  }
}
