import { CrefValidationStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { PUBLIC_PROVIDER_SELECT, jitterPublicCoordinates } from "../../providers/services/provider.service";

export class FavoriteService {
  async add(userId: string, providerId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: { user: { select: { suspendedAt: true } } }
    });
    if (!provider) {
      throw new AppError("Prestador nao encontrado.", StatusCodes.NOT_FOUND);
    }
    // Raio-X de pagamentos, Rodada 4, Lote 3: suspensão só bloqueava o
    // próprio login do profissional — a mesma correção já feita na busca
    // pública nunca chegou em favoritos.
    if (provider.crefValidationStatus !== CrefValidationStatus.APPROVED || provider.user.suspendedAt) {
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

  // Frente 5 (Descoberta, agendamento e agenda), Lote 10: lacuna de produto
  // — o profissional não tinha nenhuma forma de saber quantos clientes o
  // favoritaram.
  async countFavoritedBy(providerUserId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: providerUserId },
      select: { id: true }
    });
    if (!provider) {
      throw new AppError("Perfil de prestador não encontrado.", StatusCodes.NOT_FOUND);
    }
    const count = await prisma.favorite.count({ where: { providerId: provider.id } });
    return { count };
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
          crefValidationStatus: CrefValidationStatus.APPROVED,
          // Frente 5 (Descoberta, agendamento e agenda), Lote 5: profissional
          // suspenso continuava aparecendo nos favoritos do cliente como se
          // estivesse disponível — mesmo filtro já usado na busca pública.
          user: { suspendedAt: null }
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
