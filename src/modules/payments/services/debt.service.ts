import { StatusCodes } from "http-status-codes";
import { CardToken, Payment } from "mercadopago";
import { mp } from "../../../config/mercadopago";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { requireProviderMpAccessToken } from "../../../shared/utils/mp-provider-account";
import { platformFeeAmount } from "../../../shared/utils/platform-fee";
import { NotificationService } from "../../notifications/services/notification.service";

const mpPayment = new Payment(mp);
const mpCardToken = new CardToken(mp);
const notificationService = new NotificationService();

const OUTSTANDING_STATUSES = ["PENDING", "NOTIFIED"] as const;

function formatCents(amountCents: number) {
  return (amountCents / 100).toFixed(2).replace(".", ",");
}

// Frente 4 do roteiro de seguranca de pagamentos: registro interno de "quem
// deve o que, pra quem, por qual motivo" (ver DebtRecord no schema). So a
// divida do aluno tem uma acao de pagamento aqui — a do personal e so
// visibilidade, porque o proprio Mercado Pago ja tenta recuperar sozinho do
// proximo repasse dele.
export class DebtService {
  async listMyDebts(clientId: string) {
    return prisma.debtRecord.findMany({
      where: { clientId, debtorType: "CLIENT" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amountCents: true,
        reason: true,
        status: true,
        paidAt: true,
        createdAt: true,
        disputeCase: { select: { id: true, type: true } }
      }
    });
  }

  async listProviderDebts(userId: string) {
    const provider = await prisma.providerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!provider) {
      throw new AppError("Perfil de profissional não encontrado.", StatusCodes.NOT_FOUND);
    }
    return prisma.debtRecord.findMany({
      where: { providerId: provider.id, debtorType: "PROVIDER" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amountCents: true,
        reason: true,
        status: true,
        createdAt: true,
        disputeCase: { select: { id: true, type: true } }
      }
    });
  }

  // Usado no inicio dos 3 fluxos de compra (agendamento avulso, pacote
  // presencial, aceite de proposta de consultoria) pra bloquear novas
  // compras enquanto o aluno tiver uma pendencia em aberto.
  async assertNoOutstandingDebt(clientId: string) {
    const outstanding = await prisma.debtRecord.findFirst({
      where: { clientId, debtorType: "CLIENT", status: { in: [...OUTSTANDING_STATUSES] } }
    });
    if (outstanding) {
      throw new AppError(
        "Você tem uma pendência financeira em aberto. Regularize antes de fazer uma nova compra.",
        StatusCodes.PAYMENT_REQUIRED
      );
    }
  }

  async payDebt(clientId: string, debtId: string) {
    const debt = await prisma.debtRecord.findUnique({
      where: { id: debtId },
      include: { provider: true }
    });
    if (!debt || debt.debtorType !== "CLIENT" || debt.clientId !== clientId) {
      throw new AppError("Pendência não encontrada.", StatusCodes.NOT_FOUND);
    }
    if (debt.status === "PAID") {
      throw new AppError("Esta pendência já foi paga.", StatusCodes.BAD_REQUEST);
    }
    if (debt.status === "WRITTEN_OFF") {
      throw new AppError("Esta pendência não está mais em aberto.", StatusCodes.BAD_REQUEST);
    }

    const client = await prisma.user.findUnique({
      where: { id: clientId },
      include: {
        customerPaymentMethods: {
          where: { isActive: true, funding: "CREDIT" },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
        }
      }
    });
    if (!client?.mpCustomerId) {
      throw new AppError("Cliente sem cadastro de pagamento configurado.", StatusCodes.BAD_REQUEST);
    }
    const selectedCard = client.customerPaymentMethods[0];
    if (!selectedCard) {
      throw new AppError("Nenhum cartão de crédito ativo encontrado para pagamento.", StatusCodes.BAD_REQUEST);
    }

    const provider = debt.provider;
    const providerAccessToken = provider ? await requireProviderMpAccessToken(provider.id) : null;

    const tokenResult = await mpCardToken.create({
      body: { customer_id: client.mpCustomerId, card_id: selectedCard.mpCardId }
    });
    const cardToken = String(tokenResult.id);
    const platformFeeCents = platformFeeAmount(debt.amountCents);

    const mpPay = await mpPayment.create({
      body: {
        transaction_amount: debt.amountCents / 100,
        token: cardToken,
        installments: 1,
        payer: { type: "customer", id: client.mpCustomerId, email: client.email },
        description: `Regularização de pendência — caso ${debt.disputeCaseId}`,
        capture: true,
        metadata: { debtRecordId: debt.id, disputeCaseId: debt.disputeCaseId },
        ...(providerAccessToken && provider?.mpAccountId
          ? { collector: { id: Number(provider.mpAccountId) }, marketplace_fee: platformFeeCents / 100 }
          : {})
      },
      requestOptions: {
        idempotencyKey: `debt:${debt.id}:pay`,
        ...(providerAccessToken ? { accessToken: providerAccessToken } : {})
      }
    });

    if (mpPay.status !== "approved") {
      throw new AppError(
        `Não foi possível processar o pagamento (status: ${mpPay.status}/${mpPay.status_detail}). Tente novamente ou revise seu cartão.`,
        StatusCodes.BAD_REQUEST
      );
    }

    const updated = await prisma.debtRecord.update({
      where: { id: debt.id },
      data: { status: "PAID", mpPaymentId: String(mpPay.id), paidAt: new Date() }
    });

    if (provider) {
      void notificationService
        .sendToUsers([provider.userId], {
          preferenceType: "PAYMENTS",
          title: "Pendência regularizada",
          body: `Uma pendência de R$ ${formatCents(debt.amountCents)} foi paga pelo aluno.`,
          data: { type: "DEBT_RECORD_PAID", debtRecordId: debt.id }
        })
        .catch((error) => console.error("Falha ao notificar profissional sobre pagamento de pendência:", error));
    }

    return updated;
  }
}
