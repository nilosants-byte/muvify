import { CrefValidationStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { PUBLIC_PROVIDER_SELECT, jitterPublicCoordinates } from "../../providers/services/provider.service";

export class FavoriteService {
  async add(userId: string, providerId: string) {
    const provider = await prisma.providerProfile.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new AppError("Prestador nao encontrado.", StatusCodes.NOT_FOUND);
    }
    if (provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
      throw new AppError("Prestador nao disponivel no momento.", StatusCodes.BAD_REQUEST);
    }

    // Frente 5 (Descoberta, agendamento e agenda), Lote 1: usava `include`
    // (todas as colunas escalares do ProviderProfile), devolvendo
    // mpAccessToken/mpRefreshToken/crefDocumentUrl/credentialDocuments na
    // resposta pro cliente que favoritou - o mesmo tipo de vazamento já
    // corrigido em todo o resto de provider.service.ts (Frente 2) via
    // PUBLIC_PROVIDER_SELECT, mas que passou batido aqui.
    const favorite = await prisma.favorite.upsert({
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
      select: {
        id: true,
        userId: true,
        providerId: true,
        createdAt: true,
        provider: {
          select: {
            ...PUBLIC_PROVIDER_SELECT,
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

    return { ...favorite, provider: jitterPublicCoordinates(favorite.provider) };
  }

  async remove(userId: string, providerId: string) {
    await prisma.favorite.deleteMany({
      where: {
        userId,
        providerId
      }
    });
  }

  async list(userId: string, take = 100, skip = 0) {
    const favorites = await prisma.favorite.findMany({
      where: {
        userId,
        provider: {
          crefValidationStatus: CrefValidationStatus.APPROVED
        }
      },
      select: {
        id: true,
        userId: true,
        providerId: true,
        createdAt: true,
        provider: {
          select: {
            ...PUBLIC_PROVIDER_SELECT,
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
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });

    return favorites.map((favorite) => ({ ...favorite, provider: jitterPublicCoordinates(favorite.provider) }));
  }
}
