import { BookingStatus, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
export class ReviewService {
  async create(userId: string, bookingId: string, rating: number, comment?: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError("A nota deve ser um número inteiro entre 1 e 5.", StatusCodes.BAD_REQUEST);
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { review: true, provider: true }
    });
    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }
    if (booking.clientId !== userId) {
      throw new AppError("Apenas o cliente pode avaliar.", StatusCodes.FORBIDDEN);
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new AppError("A avaliação só pode ser enviada após o serviço ser concluído.");
    }
    if (booking.review) {
      throw new AppError("Este agendamento já foi avaliado.", StatusCodes.CONFLICT);
    }

    let review: Awaited<ReturnType<typeof prisma.review.create>>;
    try {
      review = await prisma.$transaction(async (tx) => {
      // Lock the provider row to prevent concurrent rating recalculations
      // from producing stale aggregates under READ COMMITTED isolation.
      await tx.$executeRaw`SELECT id FROM "ProviderProfile" WHERE id = ${booking.providerId} FOR UPDATE`;

      const created = await tx.review.create({
        data: {
          bookingId,
          userId,
          providerId: booking.providerId,
          rating,
          comment
        }
      });

      const aggregate = await tx.review.aggregate({
        where: { providerId: booking.providerId },
        _avg: { rating: true },
        _count: { id: true }
      });

      await tx.providerProfile.update({
        where: { id: booking.providerId },
        data: {
          averageRating: aggregate._avg.rating ?? 0,
          totalReviews: aggregate._count.id
        }
      });

      return created;
    });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError("Este agendamento já foi avaliado.", StatusCodes.CONFLICT);
      }
      throw err;
    }

    // Invalidate provider search cache (averageRating changed) and
    // schedule preview cache (booking that triggered this review is now COMPLETED).
    await Promise.all([
      deleteByPattern("providers:*"),
      deleteByPattern(`schedule:${booking.providerId}:*`)
    ]);

    const { onReviewSubmitted } = await import("../../gamification/services/gamification-events.service");
    void onReviewSubmitted(userId, review.id);

    return review;
  }

  // Frente 5 (Descoberta, agendamento e agenda), Lote 10: "Minhas avaliações"
  // reusava o endpoint de detalhe público do provider (take: 10 fixo,
  // pensado pra vitrine do cliente) — o próprio profissional nunca
  // conseguia ver nem responder avaliações além das 10 mais recentes.
  async listMine(providerUserId: string, skip = 0, take = 20) {
    take = Math.max(1, Math.min(take, 50));
    skip = Math.max(0, skip);

    const provider = await prisma.providerProfile.findUnique({
      where: { userId: providerUserId },
      select: { id: true }
    });
    if (!provider) {
      throw new AppError("Perfil de prestador não encontrado.", StatusCodes.NOT_FOUND);
    }

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { providerId: provider.id },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take
      }),
      prisma.review.count({ where: { providerId: provider.id } })
    ]);

    return { reviews, total, skip, take };
  }

  async respondToReview(providerUserId: string, reviewId: string, response: string) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: { provider: { select: { userId: true } } }
    });

    if (!review) {
      throw new AppError("Avaliação não encontrada.", StatusCodes.NOT_FOUND);
    }

    if (review.provider.userId !== providerUserId) {
      throw new AppError("Sem permissao para responder esta avaliação.", StatusCodes.FORBIDDEN);
    }

    return prisma.review.update({
      where: { id: reviewId },
      data: { providerResponse: response, providerRespondedAt: new Date() }
    });
  }
}
