import { CrefValidationStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";

export class FavoriteService {
  async add(userId: string, providerId: string) {
    const provider = await prisma.providerProfile.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new AppError("Prestador nao encontrado.", StatusCodes.NOT_FOUND);
    }
    if (provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
      throw new AppError("Prestador nao disponivel no momento.", StatusCodes.BAD_REQUEST);
    }

    return prisma.favorite.upsert({
      where: {
        userId_providerId: {
          userId,
          providerId
        }
      },
      update: {},
      create: {
        userId,
        providerId
      },
      include: {
        provider: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });
  }

  async remove(userId: string, providerId: string) {
    await prisma.favorite.deleteMany({
      where: {
        userId,
        providerId
      }
    });
  }

  async list(userId: string) {
    return prisma.favorite.findMany({
      where: {
        userId,
        provider: {
          crefValidationStatus: CrefValidationStatus.APPROVED
        }
      },
      include: {
        provider: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            },
            categoryLinks: {
              include: {
                category: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }
}
