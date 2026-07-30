import { Prisma, PresentialPackageMode } from "@prisma/client";
import { prisma } from "../../config/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

// Frente 4 (Criação/entrega/evolução do treino), Lote 1: todo cancelamento
// de uma sessão de pacote de sessões avulsas (FLEXIBLE_CREDITS) estornava o
// dinheiro mas nunca devolvia o crédito consumido - o cliente pagava por N
// sessões e nunca conseguia usar todas. Chamar sempre que um booking com
// packageId for efetivamente reembolsado (não quando o valor é capturado -
// aí a sessão foi de fato "gasta", só não foi honrada pelo cliente/culpa
// alheia).
export async function restoreFlexibleCreditForBooking(db: Db, bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { packageId: true }
  });
  if (!booking?.packageId) return;

  const pkg = await db.presentialPackage.findUnique({
    where: { id: booking.packageId },
    select: { mode: true }
  });
  if (pkg?.mode !== PresentialPackageMode.FLEXIBLE_CREDITS) return;

  await db.presentialPackage.update({
    where: { id: booking.packageId },
    data: { creditsRemainingThisCycle: { increment: 1 } }
  });
}
