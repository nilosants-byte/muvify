import { DebtRecordStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { assertAdminAccess } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";
import { requireProviderMpAccessToken } from "../../../shared/utils/mp-provider-account";
import { mpCardTokenFor, mpPaymentFor, splitFeeFields } from "../../../shared/utils/mp-clients";
import { platformFeeAmount } from "../../../shared/utils/platform-fee";
import { NotificationService } from "../../notifications/services/notification.service";

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
  // Frente 7 (segunda camada), Lote 1: faltava emailVerifiedAt aqui —
  // deixava dar baixa em dívida vulnerável a admin com e-mail revogado.
  // Implementação centralizada em shared/utils/admin-access.ts.
  private ensureAdminAccess(adminUserId: string) {
    return assertAdminAccess(adminUserId);
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

    const debt = await prisma.debtRecord.findUnique({
      where: { id: debtId },
      include: { provider: { select: { userId: true } } }
    });
    if (!debt) {
      throw new AppError("Pendência não encontrada.", StatusCodes.NOT_FOUND);
    }
    if (debt.status !== "PENDING" && debt.status !== "NOTIFIED") {
      throw new AppError("Esta pendência não está mais em aberto.", StatusCodes.BAD_REQUEST);
    }

    // Frente 7 (segunda camada), Lote 11: findUnique + checagem em memória +
    // update direto, diferente do padrão já usado em SupportTicket.reply/
    // DisputeCase.resolveCase (updateMany filtrando pelo status esperado) —
    // duas chamadas concorrentes passavam ambas pela checagem antes de
    // qualquer uma escrever. O efeito final já era idempotente aqui (as
    // duas terminam em WRITTEN_OFF), mas sem essa trava não dava pra saber
    // se essa é a chamada que de fato "ganhou" a corrida antes de notificar.
    const claimed = await prisma.debtRecord.updateMany({
      where: { id: debtId, status: debt.status },
      data: { status: "WRITTEN_OFF" }
    });
    if (claimed.count === 0) {
      throw new AppError("Esta pendência não está mais em aberto.", StatusCodes.BAD_REQUEST);
    }
    const updated = await prisma.debtRecord.findUniqueOrThrow({ where: { id: debtId } });

    await writeAdminAuditLog({
      adminId: admin.id,
      action: "DEBT_WRITTEN_OFF",
      targetType: "DEBT_RECORD",
      targetId: debtId,
      metadata: { reason: trimmedReason, amountCents: debt.amountCents }
    });

    // Frente 7 (segunda camada), Lote 11: o devedor nunca era avisado de
    // que a própria pendência tinha sido perdoada — só descobria se checasse
    // a lista de dívidas por conta própria, apesar de ser uma notícia boa.
    const debtorUserId = debt.debtorType === "CLIENT" ? debt.clientId : debt.provider?.userId ?? null;
    if (debtorUserId) {
      void notificationService
        .sendToUsers([debtorUserId], {
          preferenceType: "SYSTEM",
          title: "Pendência financeira baixada",
          body: `Sua pendência de ${formatCents(debt.amountCents)} foi baixada e não será mais cobrada. Motivo: ${trimmedReason}`,
          data: { type: "DEBT_WRITTEN_OFF" }
        })
        .catch((error) => console.error("Falha ao notificar devedor sobre baixa de pendência:", error));
    }

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
        pendingPixQrCodeUrl: true,
        pendingPixCopyPasteCode: true,
        pendingPixExpiresAt: true,
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
        pendingPixQrCodeUrl: true,
        pendingPixCopyPasteCode: true,
        pendingPixExpiresAt: true,
        disputeCase: { select: { id: true, type: true } }
      }
    });
  }

  // Usado no inicio dos 4 pontos de venda (agendamento avulso, pacote
  // presencial, combo, aceite de proposta de consultoria) pra bloquear novas
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

  // Raio-X de pagamentos, Rodada 5, Lote 4 (auditoria adversarial): a mesma
  // checagem nunca existia do lado do profissional — um profissional que
  // acumula dívida (nascida quando uma disputa é resolvida contra ele) e
  // nunca paga continuava vendendo livremente, dependendo só da MP
  // conseguir descontar sozinha do próximo repasse (que pode falhar).
  async assertProviderNoOutstandingDebt(providerId: string) {
    const outstanding = await prisma.debtRecord.findFirst({
      where: { providerId, debtorType: "PROVIDER", status: { in: [...OUTSTANDING_STATUSES] } }
    });
    if (outstanding) {
      // Frente 5 (Descoberta, agendamento e agenda), Lote 8: os 4 pontos
      // que chamam essa checagem (booking avulso, aceite de consultoria,
      // compra de pacote/combo) são todos ações do CLIENTE — a mensagem
      // antiga ("regularize antes de vender um novo serviço") era escrita
      // na perspectiva do profissional, mas quem via o erro era sempre o
      // cliente, sem nenhuma ação possível sobre a dívida de outra pessoa.
      throw new AppError(
        "Este profissional está temporariamente indisponível para novos agendamentos.",
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
  async payDebt(userId: string, debtId: string, method: "CARD" | "PIX" = "CARD") {
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

    if (method === "PIX") {
      return this.createDebtPix(debt, isClientDebt, userId);
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
    const selectedCard = debtor?.customerPaymentMethods[0];
    if (!debtor?.mpCustomerId || !selectedCard) {
      throw new AppError(
        "Você não tem um cartão de crédito salvo. Pague por Pix ou cadastre um cartão em Perfil → Métodos de pagamento.",
        StatusCodes.BAD_REQUEST
      );
    }

    const provider = isClientDebt ? debt.provider : null;
    const providerAccessToken = provider ? await requireProviderMpAccessToken(provider.id) : null;

    // Pergunta do Danilo (teste manual C8.1, 21/10/2026): quem gerou um Pix e
    // desistiu pode pagar no cartão. Antes de cobrar, cancela o Pix em aberto
    // no Mercado Pago — senão o aluno poderia pagar os dois. Se o Pix já
    // tiver sido pago, não cobra o cartão: só dá baixa pelo Pix.
    if (debt.pendingPixMpPaymentId) {
      const pixPaid = await this.cancelPendingDebtPix(debt.id, debt.pendingPixMpPaymentId, providerAccessToken);
      if (pixPaid) {
        return prisma.debtRecord.findUniqueOrThrow({ where: { id: debt.id } });
      }
    }

    const tokenResult = await mpCardTokenFor().create({
      body: { customer_id: debtor.mpCustomerId, card_id: selectedCard.mpCardId }
    });
    const cardToken = String(tokenResult.id);
    const platformFeeCents = platformFeeAmount(debt.amountCents);

    const mpPay = await mpPaymentFor(providerAccessToken).create({
      body: {
        transaction_amount: debt.amountCents / 100,
        token: cardToken,
        installments: 1,
        // Na conta do personal o customer da plataforma não existe.
        payer: providerAccessToken ? { email: debtor.email } : { type: "customer", id: debtor.mpCustomerId, email: debtor.email },
        description: `Regularização de pendência — caso ${debt.disputeCaseId}`,
        capture: true,
        metadata: { debtRecordId: debt.id, disputeCaseId: debt.disputeCaseId },
        ...splitFeeFields(providerAccessToken, platformFeeCents)
      },
      requestOptions: {
        // updatedAt na chave: toque duplo cai na mesma chave (MP não cobra 2x),
        // mas depois de uma recusa (que mexe no updatedAt abaixo) a nova
        // tentativa ganha chave nova — antes o MP devolvia a recusa antiga
        // pra sempre, mesmo trocando de cartão.
        idempotencyKey: `debt:${debt.id}:pay:${debt.updatedAt.getTime()}`
      }
    });

    if (mpPay.status !== "approved") {
      await prisma.debtRecord.update({ where: { id: debt.id }, data: { updatedAt: new Date() } });
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
      this.notifyProviderDebtPaid(provider.userId, debt.id, debt.amountCents);
    }

    return updated;
  }

  private notifyProviderDebtPaid(providerUserId: string, debtId: string, amountCents: number) {
    void notificationService
      .sendToUsers([providerUserId], {
        preferenceType: "PAYMENTS",
        title: "Pendência regularizada",
        body: `Uma pendência de R$ ${formatCents(amountCents)} foi paga pelo aluno.`,
        data: { type: "DEBT_RECORD_PAID", debtRecordId: debtId }
      })
      .catch((error) => console.error("Falha ao notificar profissional sobre pagamento de pendência:", error));
  }

  // Decisão do Danilo (teste manual C8.1, 20/10/2026): pendência também pode
  // ser paga por Pix — antes só cartão salvo, e quem não tinha cartão ficava
  // bloqueado pra sempre de agendar/contratar. Reaproveita o Pix ainda válido
  // (não gera um novo a cada toque); a confirmação vem pelo webhook
  // (confirmDebtPixPayment).
  private async createDebtPix(
    debt: { id: string; amountCents: number; disputeCaseId: string; pendingPixMpPaymentId: string | null; pendingPixExpiresAt: Date | null; provider: { id: string; mpAccountId: string | null } | null },
    isClientDebt: boolean,
    userId: string
  ) {
    if (debt.pendingPixMpPaymentId && debt.pendingPixExpiresAt && debt.pendingPixExpiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return prisma.debtRecord.findUniqueOrThrow({ where: { id: debt.id } });
    }

    const debtor = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
    const provider = isClientDebt ? debt.provider : null;
    const providerAccessToken = provider ? await requireProviderMpAccessToken(provider.id) : null;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const nameParts = debtor.name.split(" ");

    const mpPay = await mpPaymentFor(providerAccessToken).create({
      body: {
        transaction_amount: debt.amountCents / 100,
        payment_method_id: "pix",
        date_of_expiration: expiresAt.toISOString(),
        payer: { email: debtor.email, first_name: nameParts[0], last_name: nameParts.slice(1).join(" ") || undefined },
        description: `Regularização de pendência — caso ${debt.disputeCaseId}`,
        metadata: { debtRecordId: debt.id, disputeCaseId: debt.disputeCaseId },
        ...splitFeeFields(providerAccessToken, platformFeeAmount(debt.amountCents))
      },
      requestOptions: {
        // Um Pix por tentativa (o anterior pode ter expirado).
        idempotencyKey: `debt:${debt.id}:pix:${expiresAt.getTime()}`
      }
    });

    const poi = mpPay.point_of_interaction as Record<string, unknown> | null | undefined;
    const tx = (poi?.["transaction_data"] as Record<string, unknown> | null | undefined) ?? null;
    return prisma.debtRecord.update({
      where: { id: debt.id },
      data: {
        pendingPixMpPaymentId: String(mpPay.id),
        pendingPixQrCodeUrl: (tx?.["qr_code_base64"] as string | null) ?? null,
        pendingPixCopyPasteCode: (tx?.["qr_code"] as string | null) ?? null,
        pendingPixExpiresAt: expiresAt
      }
    });
  }

  // Retorna true se o Pix já estava pago (pendência baixada por ele).
  private async cancelPendingDebtPix(debtId: string, pixMpPaymentId: string, accessToken: string | null) {
    let status: string | undefined;
    try {
      status = (await mpPaymentFor(accessToken).get({ id: pixMpPaymentId })).status ?? undefined;
    } catch {
      throw new AppError("Não foi possível conferir o Pix em aberto. Tente de novo em instantes.", StatusCodes.BAD_GATEWAY);
    }
    if (status === "approved") {
      await this.confirmDebtPixPayment(pixMpPaymentId, status);
      return true;
    }
    if (status === "pending" || status === "in_process") {
      try {
        await mpPaymentFor(accessToken).cancel({
          id: pixMpPaymentId,
          requestOptions: { idempotencyKey: `debt:${debtId}:pix-cancel:${pixMpPaymentId}` }
        });
      } catch {
        throw new AppError("Não foi possível cancelar o Pix em aberto. Tente de novo em instantes.", StatusCodes.BAD_GATEWAY);
      }
    }
    await prisma.debtRecord.update({
      where: { id: debtId },
      data: { pendingPixMpPaymentId: null, pendingPixQrCodeUrl: null, pendingPixCopyPasteCode: null, pendingPixExpiresAt: null }
    });
    return false;
  }

  // Chamado pelo webhook do Mercado Pago (payment.service.ts) quando o Pix de
  // uma pendência muda de status. Retorna true se o pagamento era de uma
  // pendência (já tratado aqui).
  async confirmDebtPixPayment(mpPaymentId: string, mpStatus: string | undefined): Promise<boolean> {
    const debt = await prisma.debtRecord.findUnique({
      where: { pendingPixMpPaymentId: mpPaymentId },
      include: { provider: { select: { userId: true } } }
    });
    if (!debt) return false;
    if (mpStatus !== "approved") return true;
    const updated = await prisma.debtRecord.updateMany({
      where: { id: debt.id, status: { in: ["PENDING", "NOTIFIED"] } },
      data: {
        status: "PAID",
        mpPaymentId,
        paidAt: new Date(),
        pendingPixMpPaymentId: null,
        pendingPixQrCodeUrl: null,
        pendingPixCopyPasteCode: null,
        pendingPixExpiresAt: null
      }
    });
    if (updated.count > 0 && debt.debtorType === "CLIENT" && debt.provider) {
      this.notifyProviderDebtPaid(debt.provider.userId, debt.id, debt.amountCents);
    }
    return true;
  }
}
