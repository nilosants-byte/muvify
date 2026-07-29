import { DebtRecordStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { CardToken, Payment } from "mercadopago";
import { mp } from "../../../config/mercadopago";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { isAdminEmail } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";
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
  private async ensureAdminAccess(adminUserId: string) {
    const admin = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, email: true }
    });
    if (!admin || !isAdminEmail(admin.email)) {
      throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
    }
    return admin;
  }

  // Raio-X de pagamentos, Rodada 3, Lote 6: o admin não tinha nenhuma visão
  // agregada de dívidas — só existiam listagens por cliente/profissional
  // (listMyDebts/listProviderDebts), nenhuma pra operação em conjunto.
  //
  // Raio-X de pagamentos, Rodada 4, Lote 13: take:200 fixo, sem nenhum
  // indicador de "há mais" — acima desse número, dívidas mais antigas
  // simplesmente sumiam da lista sem ninguém perceber.
  async listAllDebts(adminId: string, status?: DebtRecordStatus, skip = 0, take = 100) {
    await this.ensureAdminAccess(adminId);
    const boundedTake = Math.min(Math.max(take, 1), 200);
    const boundedSkip = Math.max(skip, 0);

    const rows = await prisma.debtRecord.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      skip: boundedSkip,
      take: boundedTake + 1,
      select: {
        id: true,
        debtorType: true,
        amountCents: true,
        reason: true,
        status: true,
        paidAt: true,
        createdAt: true,
        disputeCase: { select: { id: true, type: true } },
        client: { select: { id: true, name: true, email: true } },
        provider: { select: { id: true, displayName: true, user: { select: { email: true } } } }
      }
    });

    const hasMore = rows.length > boundedTake;
    return { items: rows.slice(0, boundedTake), hasMore };
  }

  // O enum já previa WRITTEN_OFF (dívida incobrável) mas nada nunca setava
  // esse status — o admin não tinha como dar baixa numa dívida que decidiu
  // não cobrar mais (ex: valor irrisório, cliente/profissional sumiu).
  async writeOffDebt(adminId: string, debtId: string, reason: string) {
    const admin = await this.ensureAdminAccess(adminId);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new AppError("Informe o motivo da baixa.", StatusCodes.BAD_REQUEST);
    }

    const debt = await prisma.debtRecord.findUnique({ where: { id: debtId } });
    if (!debt) {
      throw new AppError("Pendência não encontrada.", StatusCodes.NOT_FOUND);
    }
    if (debt.status !== "PENDING" && debt.status !== "NOTIFIED") {
      throw new AppError("Esta pendência não está mais em aberto.", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.debtRecord.update({
      where: { id: debtId },
      data: { status: "WRITTEN_OFF" }
    });

    void writeAdminAuditLog({
      adminId: admin.id,
      action: "DEBT_WRITTEN_OFF",
      targetType: "DEBT_RECORD",
      targetId: debtId,
      metadata: { reason: trimmedReason, amountCents: debt.amountCents }
    });

    return updated;
  }

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

  // Raio-X de pagamentos, Rodada 4, Lote 6: dívida do profissional (nasce
  // quando uma disputa é resolvida como reembolso ao cliente, e o valor já
  // tinha sido repassado ao profissional) nunca tinha ação de pagamento
  // nenhuma — só o Mercado Pago tentando sozinho descontar do próximo
  // repasse, sem nenhuma confirmação de que isso realmente aconteceu. Agora
  // reaproveita a mesma mecânica já usada pra dívida do cliente, generalizada
  // pros dois lados. Diferença: dívida do cliente é cobrada com o
  // profissional como collector (marketplace split, porque o dinheiro é
  // devido a ele); dívida do profissional vai direto pra conta da própria
  // plataforma — é dinheiro que ele recebeu indevidamente, não um repasse.
  async payDebt(userId: string, debtId: string) {
    const debt = await prisma.debtRecord.findUnique({
      where: { id: debtId },
      include: { provider: true }
    });
    if (!debt) {
      throw new AppError("Pendência não encontrada.", StatusCodes.NOT_FOUND);
    }
    const isClientDebt = debt.debtorType === "CLIENT" && debt.clientId === userId;
    const isProviderDebt = debt.debtorType === "PROVIDER" && debt.provider?.userId === userId;
    if (!isClientDebt && !isProviderDebt) {
      throw new AppError("Pendência não encontrada.", StatusCodes.NOT_FOUND);
    }
    if (debt.status === "PAID") {
      throw new AppError("Esta pendência já foi paga.", StatusCodes.BAD_REQUEST);
    }
    if (debt.status === "WRITTEN_OFF") {
      throw new AppError("Esta pendência não está mais em aberto.", StatusCodes.BAD_REQUEST);
    }

    const debtor = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerPaymentMethods: {
          where: { isActive: true, funding: "CREDIT" },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
        }
      }
    });
    if (!debtor?.mpCustomerId) {
      throw new AppError("Cadastro de pagamento não configurado.", StatusCodes.BAD_REQUEST);
    }
    const selectedCard = debtor.customerPaymentMethods[0];
    if (!selectedCard) {
      throw new AppError("Nenhum cartão de crédito ativo encontrado para pagamento.", StatusCodes.BAD_REQUEST);
    }

    const provider = isClientDebt ? debt.provider : null;
    const providerAccessToken = provider ? await requireProviderMpAccessToken(provider.id) : null;

    const tokenResult = await mpCardToken.create({
      body: { customer_id: debtor.mpCustomerId, card_id: selectedCard.mpCardId }
    });
    const cardToken = String(tokenResult.id);
    const platformFeeCents = platformFeeAmount(debt.amountCents);

    const mpPay = await mpPayment.create({
      body: {
        transaction_amount: debt.amountCents / 100,
        token: cardToken,
        installments: 1,
        payer: { type: "customer", id: debtor.mpCustomerId, email: debtor.email },
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

    if (isClientDebt && provider) {
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
