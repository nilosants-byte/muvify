import { StatusCodes } from "http-status-codes";
import { prisma } from "../../config/prisma";
import { AppError } from "../errors/app-error";
import { isOnboardingGatesBypassActive } from "./onboarding-gates-bypass";

// Frente 3 (Cadastro/onboarding), Lote 5: emailVerifiedAt só afetava
// elegibilidade a ADMIN - login e uso pleno do app não exigiam posse do
// e-mail. Qualquer pessoa podia usar o e-mail de terceiros no cadastro e
// operar o app normalmente (reservas, pagamentos, mensagens) sem nunca
// confirmar. Aplica em ações de negócio sensíveis (booking, compra,
// mensagem) - navegação/login continuam liberados.
export async function assertEmailVerified(userId: string) {
  if (isOnboardingGatesBypassActive()) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true }
  });
  if (!user?.emailVerifiedAt) {
    throw new AppError(
      "Confirme seu e-mail antes de continuar. Reenvie o link de verificação nas configurações da conta.",
      StatusCodes.FORBIDDEN
    );
  }
}
