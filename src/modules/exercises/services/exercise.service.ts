import { ConsultancyContractStatus, ExerciseMediaType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { ENABLE_VIDEO_UPLOAD } from "../../../config/features";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { assertAdminAccess } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";

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
  // Frente 7 (segunda camada), Lote 1: implementação movida pra
  // shared/utils/admin-access.ts::assertAdminAccess (centralizada de vez).
  private async ensureAdminAccess(adminId: string) {
    await assertAdminAccess(adminId);
  }

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

  async createPrebuilt(adminId: string, input: {
    name: string;
    category: string;
    description?: string;
    defaultRepetitionsSets?: string;
    defaultRestLabel?: string;
    mediaUrl?: string;
    mediaType?: ExerciseMediaType;
  }) {
    await this.ensureAdminAccess(adminId);

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
    await writeAdminAuditLog({
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
    await this.ensureAdminAccess(adminId);

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

    await writeAdminAuditLog({
      adminId,
      action: "EXERCISE_PREBUILT_UPDATED",
      targetType: "EXERCISE",
      targetId: exerciseId
    });

    return updated;
  }

  async deletePrebuilt(adminId: string, exerciseId: string) {
    await this.ensureAdminAccess(adminId);

    const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) throw new AppError("Exercício não encontrado.", StatusCodes.NOT_FOUND);
    if (!exercise.isPrebuilt) throw new AppError("Exercício não é pré-montado.", StatusCodes.BAD_REQUEST);

    // Frente 5 (segunda camada), Lote 8: `delete` (exercício próprio do
    // profissional) já tinha essa mesma checagem desde a Frente 4/Lote 4 —
    // `deletePrebuilt` (biblioteca compartilhada, admin) ficou de fora. O
    // FK usa onDelete: SetNull (TrainingPlanExercise guarda cópia própria
    // do nome/reps/carga, então a ficha do aluno continua funcionando),
    // mas o admin merece o mesmo aviso antes de excluir algo em uso.
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

    await writeAdminAuditLog({
      adminId,
      action: "EXERCISE_PREBUILT_DELETED",
      targetType: "EXERCISE",
      targetId: exerciseId,
      metadata: { name: exercise.name, category: exercise.category }
    });
  }
}
