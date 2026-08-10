import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { assertAdminAccess } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";
import { deleteByPattern, getCache, setCache } from "../../../shared/utils/cache";
import { normalizeLoose } from "../../../shared/utils/normalize-text";

export class CategoryService {
  // Frente 7 (segunda camada), Lote 1: implementação movida pra
  // shared/utils/admin-access.ts::assertAdminAccess (centralizada de vez).
  private async ensureAdminAccess(adminId: string) {
    await assertAdminAccess(adminId);
  }

  async create(adminId: string, name: string, description?: string) {
    await this.ensureAdminAccess(adminId);
    // Frente 3 (Cadastro/onboarding), Lote 4: a unique constraint do banco é
    // case-sensitive e não remove acento - "Pilates" e "Pilátes" criados
    // manualmente por admins em momentos diferentes coexistiam como
    // categorias distintas. Mesma normalização já usada na criação
    // automática via especialidade do provider.
    // Frente 5 (segunda camada), Lote 11: checagem só olhava categorias
    // `active: true` — resolveCategoryIdsFromSpecialties (mesma ideia, do
    // lado do provider) já documenta por que precisa considerar inativas
    // também: recriar "Pilates" com grafia diferente depois que a
    // original foi desativada não era pego, já que a unique constraint do
    // banco é por nome exato, independente do status.
    const allCategories = await prisma.serviceCategory.findMany({
      select: { name: true }
    });
    const normalizedTarget = normalizeLoose(name);
    const duplicate = allCategories.some((c) => normalizeLoose(c.name) === normalizedTarget);
    if (duplicate) {
      throw new AppError("Categoria já existe.", StatusCodes.CONFLICT);
    }

    try {
      const category = await prisma.serviceCategory.create({ data: { name, description } });
      await deleteByPattern("categories:*");
      void writeAdminAuditLog({
        adminId,
        action: "CATEGORY_CREATED",
        targetType: "CATEGORY",
        targetId: category.id,
        metadata: { name: category.name }
      });
      return category;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError("Categoria já existe.", StatusCodes.CONFLICT);
      }
      throw err;
    }
  }
  async list() {
    const cacheKey = "categories:list";
    const cached = await getCache(cacheKey);
    if (cached) {
      return cached;
    }
    // Frente 3 (Cadastro/onboarding), Lote 4: categoria desativada não
    // aparece mais na listagem pública/de especialidades - continua íntegra
    // no banco pra quem já a referencia (booking, pacote, perfil).
    const categories = await prisma.serviceCategory.findMany({
      where: { active: true },
      orderBy: { name: "asc" }
    });
    await setCache(cacheKey, categories, 600);
    return categories;
  }

  async deactivate(adminId: string, categoryId: string) {
    await this.ensureAdminAccess(adminId);

    const category = await prisma.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new AppError("Categoria não encontrada.", StatusCodes.NOT_FOUND);
    }
    const updated = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { active: false }
    });
    await deleteByPattern("categories:*");
    void writeAdminAuditLog({
      adminId,
      action: "CATEGORY_DEACTIVATED",
      targetType: "CATEGORY",
      targetId: categoryId,
      metadata: { name: category.name }
    });
    return updated;
  }

  async reactivate(adminId: string, categoryId: string) {
    await this.ensureAdminAccess(adminId);

    const category = await prisma.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new AppError("Categoria não encontrada.", StatusCodes.NOT_FOUND);
    }
    const updated = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { active: true }
    });
    await deleteByPattern("categories:*");
    void writeAdminAuditLog({
      adminId,
      action: "CATEGORY_REACTIVATED",
      targetType: "CATEGORY",
      targetId: categoryId,
      metadata: { name: category.name }
    });
    return updated;
  }
}
