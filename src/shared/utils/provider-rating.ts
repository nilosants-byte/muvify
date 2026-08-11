import { Prisma, PaymentStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";

// Frente 5 (Descoberta, agendamento e agenda), Lote 4: o agregado de rating
// do profissional nunca era recalculado quando o pagamento de uma sessão já
// avaliada era estornado depois (contestação de no-show, disputa resolvida
// pelo admin) — a review continuava contando pra sempre, mesmo o admin
// tendo concordado que a cobrança estava errada. Só exclui reviews cujo
// pagamento foi de fato estornado por completo; bookings sem Payment
// próprio (sessão de pacote de horário fixo, cobrada no ciclo) continuam
// contando normalmente.
export async function recalculateProviderRatingAfterRefund(
  bookingId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const review = await db.review.findUnique({
    where: { bookingId },
    select: { providerId: true }
  });
  if (!review) return;

  const aggregate = await db.review.aggregate({
    where: {
      providerId: review.providerId,
      // Frente 9 (segunda camada), Lote 4: bookingId virou opcional (review
      // de consultoria não tem booking) — o filtro "booking: {...}" sozinho
      // usa semântica de INNER JOIN pra relação opcional, excluindo do
      // agregado qualquer review sem bookingId. Sem o OR abaixo, toda
      // review de consultoria do profissional sumiria do rating sempre que
      // QUALQUER booking dele fosse reembolsado.
      OR: [
        { bookingId: null },
        { booking: { OR: [{ payment: null }, { payment: { status: { not: PaymentStatus.REFUNDED } } }] } }
      ]
    },
    _avg: { rating: true },
    _count: { id: true }
  });

  await db.providerProfile.update({
    where: { id: review.providerId },
    data: {
      averageRating: aggregate._avg.rating ?? 0,
      totalReviews: aggregate._count.id
    }
  });
}
