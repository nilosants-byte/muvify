import { BookingStatus, ConsultancyContractStatus, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
export class ReviewService {
  async create(
    userId: string,
    input: { bookingId?: string; contractId?: string },
    rating: number,
    comment?: string
  ) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError("A nota deve ser um número inteiro entre 1 e 5.", StatusCodes.BAD_REQUEST);
    }

    if (input.bookingId) {
      return this.createForBooking(userId, input.bookingId, rating, comment);
    }
    if (input.contractId) {
      return this.createForConsultancyContract(userId, input.contractId, rating, comment);
    }
    throw new AppError("Informe um agendamento ou uma consultoria para avaliar.", StatusCodes.BAD_REQUEST);
  }

  private async createForBooking(userId: string, bookingId: string, rating: number, comment?: string) {
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
    // Achado em teste manual (2026-10-16): a conclusão presencial exige
    // confirmação dos dois lados (cliente e profissional) pra virar
    // COMPLETED de verdade — mas isso é sobre quando capturar o pagamento,
    // não sobre se o cliente já viveu a experiência o bastante pra avaliar.
    // Exigir COMPLETED aqui bloqueava a avaliação logo depois do cliente
    // confirmar a própria conclusão (com selfie e tudo), bem no momento em
    // que a tela já oferece a avaliação pra ele fazer na hora — exatamente
    // quando ele não vai voltar depois pra avaliar. clientConfirmedAt já
    // é a prova de que o cliente concluiu a parte dele.
    if (booking.status !== BookingStatus.COMPLETED && !booking.clientConfirmedAt) {
      throw new AppError("A avaliação só pode ser enviada após você confirmar a conclusão do atendimento.");
    }
    // clientConfirmedAt sozinho não garante que a sessão de fato "contou" —
    // um agendamento pode, em tese, ainda virar CANCELLED depois do cliente
    // confirmar sua própria conclusão (ex: disputa resolvida a favor do
    // cancelamento). Nunca aceitar avaliação de uma sessão oficialmente
    // cancelada, mesmo que a confirmação do cliente já exista.
    if (booking.status === BookingStatus.CANCELLED) {
      throw new AppError("Este agendamento foi cancelado e não pode ser avaliado.", StatusCodes.BAD_REQUEST);
    }
    if (booking.review) {
      throw new AppError("Este agendamento já foi avaliado.", StatusCodes.CONFLICT);
    }

    return this.createReviewAndRecalculate(
      { bookingId, userId, providerId: booking.providerId, rating, comment },
      "Este agendamento já foi avaliado."
    );
  }

  // Frente 9 (segunda camada), Lote 4: mesma avaliação, agora também pro
  // lado online - exigir DELIVERED (pelo menos uma ficha entregue) é o
  // equivalente de booking.status === COMPLETED (serviço de fato rendido).
  private async createForConsultancyContract(userId: string, contractId: string, rating: number, comment?: string) {
    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: { review: true }
    });
    if (!contract) {
      throw new AppError("Consultoria não encontrada.", StatusCodes.NOT_FOUND);
    }
    if (contract.clientId !== userId) {
      throw new AppError("Apenas o cliente pode avaliar.", StatusCodes.FORBIDDEN);
    }
    if (contract.status !== ConsultancyContractStatus.DELIVERED) {
      throw new AppError("A avaliação só pode ser enviada após a entrega da consultoria.", StatusCodes.BAD_REQUEST);
    }
    if (contract.review) {
      throw new AppError("Esta consultoria já foi avaliada.", StatusCodes.CONFLICT);
    }

    return this.createReviewAndRecalculate(
      { consultancyContractId: contractId, userId, providerId: contract.providerId, rating, comment },
      "Esta consultoria já foi avaliada."
    );
  }

  private async createReviewAndRecalculate(
    data: {
      bookingId?: string;
      consultancyContractId?: string;
      userId: string;
      providerId: string;
      rating: number;
      comment?: string;
    },
    conflictMessage: string
  ) {
    let review: Awaited<ReturnType<typeof prisma.review.create>>;
    try {
      review = await prisma.$transaction(async (tx) => {
        // Lock the provider row to prevent concurrent rating recalculations
        // from producing stale aggregates under READ COMMITTED isolation.
        await tx.$executeRaw`SELECT id FROM "ProviderProfile" WHERE id = ${data.providerId} FOR UPDATE`;

        const created = await tx.review.create({ data });

        const aggregate = await tx.review.aggregate({
          where: { providerId: data.providerId },
          _avg: { rating: true },
          _count: { id: true }
        });

        await tx.providerProfile.update({
          where: { id: data.providerId },
          data: {
            averageRating: aggregate._avg.rating ?? 0,
            totalReviews: aggregate._count.id
          }
        });

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(conflictMessage, StatusCodes.CONFLICT);
      }
      throw err;
    }

    // Invalidate provider search cache (averageRating changed) and
    // schedule preview cache (booking that triggered this review is now COMPLETED).
    await Promise.all([
      deleteByPattern("providers:*"),
      deleteByPattern(`schedule:${data.providerId}:*`)
    ]);

    const { onReviewSubmitted } = await import("../../gamification/services/gamification-events.service");
    void onReviewSubmitted(data.userId, review.id);

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
      throw new AppError("Sem permissão para responder esta avaliação.", StatusCodes.FORBIDDEN);
    }

    return prisma.review.update({
      where: { id: reviewId },
      data: { providerResponse: response, providerRespondedAt: new Date() }
    });
  }
}
