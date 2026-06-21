import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern, getCache, setCache } from "../../../shared/utils/cache";
export class CategoryService {
  async create(name: string, description?: string) {
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
    const categories = await prisma.serviceCategory.findMany({
      orderBy: { name: "asc" }
    });
    await setCache(cacheKey, categories, 600);
    return categories;
  }
}
