import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern, getCache, setCache } from "../../../shared/utils/cache";
import { normalizeLoose } from "../../../shared/utils/normalize-text";

export class CategoryService {
  async create(name: string, description?: string) {
    // Frente 3 (Cadastro/onboarding), Lote 4: a unique constraint do banco é
    // case-sensitive e não remove acento - "Pilates" e "Pilátes" criados
    // manualmente por admins em momentos diferentes coexistiam como
    // categorias distintas. Mesma normalização já usada na criação
    // automática via especialidade do provider.
    const activeCategories = await prisma.serviceCategory.findMany({
      where: { active: true },
      select: { name: true }
    });
    const normalizedTarget = normalizeLoose(name);
    const duplicate = activeCategories.some((c) => normalizeLoose(c.name) === normalizedTarget);
    if (duplicate) {
      throw new AppError("Categoria já existe.", StatusCodes.CONFLICT);
    }

    try {
      const category = await prisma.serviceCategory.create({ data: { name, description } });
      await deleteByPattern("categories:*");
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

  async deactivate(categoryId: string) {
    const category = await prisma.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new AppError("Categoria não encontrada.", StatusCodes.NOT_FOUND);
    }
    const updated = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { active: false }
    });
    await deleteByPattern("categories:*");
    return updated;
  }

  async reactivate(categoryId: string) {
    const category = await prisma.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new AppError("Categoria não encontrada.", StatusCodes.NOT_FOUND);
    }
    const updated = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { active: true }
    });
    await deleteByPattern("categories:*");
    return updated;
  }
}
