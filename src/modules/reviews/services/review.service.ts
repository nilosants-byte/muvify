import { BookingStatus } from "@prisma/client";
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

    const review = await prisma.$transaction(async (tx) => {
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

    // Invalidate provider search cache (averageRating changed) and
    // schedule preview cache (booking that triggered this review is now COMPLETED).
    await Promise.all([
      deleteByPattern("providers:*"),
      deleteByPattern(`schedule:${booking.providerId}:*`)
    ]);
    return review;
  }
}
