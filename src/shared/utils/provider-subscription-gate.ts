import { StatusCodes } from "http-status-codes";
import { prisma } from "../../config/prisma";
import { AppError } from "../errors/app-error";
import { isProviderSubscriptionActive } from "../../modules/providers/services/provider-subscription.service";

const DEFAULT_MESSAGE =
  "Você ainda não tem assinatura ativa no Muvify. Ative sua assinatura para continuar.";

// Bloco 6 (bloqueio por assinatura inativa): mesmo racional do gate de CREF já
// espalhado pelo código (ensureProviderCrefApproved em consultancy.service.ts)
// — uma checagem só, sem exceção pra cliente já pagante. Usado por services
// que não passam por ConsultancyService.providerProfileByUserId (que já tem
// sua própria variante síncrona, reaproveitando o fetch que já roda ali).
// `providerId` é a chave única de ProviderSubscription — lookup indexado e
// barato, mesmo padrão de custo de assertNoActiveEngagementWithOtherProvider
// (client-engagement.ts, Bloco 3).
export async function assertProviderSubscriptionActive(
  providerId: string,
  message: string = DEFAULT_MESSAGE
): Promise<void> {
  const subscription = await prisma.providerSubscription.findUnique({
    where: { providerId },
    select: { status: true }
  });
  if (!isProviderSubscriptionActive(subscription?.status)) {
    throw new AppError(message, StatusCodes.BAD_REQUEST, { code: "SUBSCRIPTION_REQUIRED" });
  }
}
