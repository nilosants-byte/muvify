import { DisputeCaseResolution, DisputeCaseStatus, PaymentStatus, ConsultancyPaymentStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { PaymentRefund } from "mercadopago";
import { mp } from "../../../config/mercadopago";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { assertAdminAccess } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";
import { NotificationService } from "../../notifications/services/notification.service";
import { PaymentService } from "../../payments/services/payment.service";
import { providerSplitAmount } from "../../../shared/utils/platform-fee";
import { restoreFlexibleCreditForBooking } from "../../../shared/utils/presential-package-credit";
import { recalculateProviderRatingAfterRefund } from "../../../shared/utils/provider-rating";

const mpRefund = new PaymentRefund(mp);

type ResolveDisputeCaseInput = {
  // Raio-X de pagamentos, Rodada 2, Lote 2: RETRY_CAPTURE só se aplica a
  // casos type=CAPTURE_FAILED — tenta capturar de novo o pagamento que
  // nunca chegou a ser cobrado (reembolsar não faz sentido aqui, pois nunca
  // houve cobrança pra devolver).
  resolution: "REFUNDED" | "DENIED" | "RETRY_CAPTURE";
  amountCents?: number;
  note: string;
  // So aplicavel quando resolution === "DENIED": registra que o aluno ja
  // recebeu esse valor indevidamente antes desta disputa ser aberta (caso
  // raro em que um reembolso anterior acaba sendo revertido pelo julgamento
  // do admin). Ver DebtRecord no schema.
  chargeClientDebtCents?: number;
};

function formatCents(amountCents: number) {
  return (amountCents / 100).toFixed(2).replace(".", ",");
}

// Fila unica de casos que precisam de julgamento humano (ver DisputeCase no
// schema). Um admin so consegue resolver um caso informando um motivo, que
// viaja verbatim na notificacao pras duas partes (cliente e profissional).
export class DisputeCaseService {
  private notificationService = new NotificationService();
  private paymentService = new PaymentService();

  // Frente 7 (segunda camada), Lote 1: faltava emailVerifiedAt aqui — a
  // mesma checagem já tinha sido corrigida 3 vezes em outros services
  // (admin.service.ts, moderation.service.ts, exercise.service.ts) sem
  // nunca ser reaplicada aqui, deixando resolveCase (reembolso/captura
  // real via Mercado Pago) vulnerável a um admin com e-mail revogado.
  // Implementação centralizada em shared/utils/admin-access.ts.
  private ensureAdminAccess(adminUserId: string) {
    return assertAdminAccess(adminUserId);
  }

  // Raio-X de pagamentos, Rodada 4, Lote 11: cliente não tinha nenhum lugar
  // central pra acompanhar as próprias disputas em andamento — só o texto
  // genérico "está em análise" em algum outro fluxo, sem histórico nem
  // status real. Auto-atendimento (sem ensureAdminAccess): cada um só vê os
  // próprios casos, como cliente ou como profissional.
  async listMyDisputes(userId: string) {
    return prisma.disputeCase.findMany({
      where: { OR: [{ clientId: userId }, { provider: { userId } }] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        status: true,
        amountCents: true,
        resolution: true,
        resolvedAmountCents: true,
        resolutionNote: true,
        createdAt: true,
        resolvedAt: true,
        clientId: true,
        // Frente 6 (segunda camada), Lote 10: MyDisputesScreen agora também
        // é usada pelo profissional — sem o nome do cliente, a tela mostraria
        // "Com {o próprio nome do profissional}" nesse caso (reaproveitando
        // a mesma lógica que já mostrava o nome do profissional pro cliente).
        client: { select: { id: true, name: true } },
        provider: { select: { id: true, displayName: true, userId: true } }
      }
    });
  }

  // Frente 7 (segunda camada), Lote 4: take:200 fixo sem skip, ordenado do
  // mais antigo pro mais recente — se o total (aberto + resolvido) passar de
  // 200, os casos OPEN mais recentes (os que mais precisam de julgamento)
  // ficavam inalcançáveis mesmo filtrando por status, porque não havia como
  // avançar a página. Mesmo padrão de paginação (skip/take + hasMore) já
  // usado em DebtService.listAllDebts.
  async listCases(adminId: string, status?: DisputeCaseStatus, skip = 0, take = 50) {
    await this.ensureAdminAccess(adminId);
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=listDisputeCases status=${status ?? "all"}`);

    const boundedTake = Math.min(Math.max(take, 1), 200);
    const boundedSkip = Math.max(skip, 0);

    const rows = await prisma.disputeCase.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "asc" },
      skip: boundedSkip,
      take: boundedTake + 1,
      select: {
        id: true,
        type: true,
        status: true,
        amountCents: true,
        resolution: true,
        resolvedAmountCents: true,
        createdAt: true,
        resolvedAt: true,
        client: { select: { id: true, name: true, email: true } },
        provider: { select: { id: true, displayName: true, user: { select: { email: true } } } }
      }
    });

    const hasMore = rows.length > boundedTake;
    return { items: rows.slice(0, boundedTake), hasMore };
  }

  async getCaseDetail(adminId: string, caseId: string) {
    await this.ensureAdminAccess(adminId);
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=getDisputeCaseDetail caseId=${caseId}`);

    const disputeCase = await prisma.disputeCase.findUnique({
      where: { id: caseId },
      include: {
        client: { select: { id: true, name: true, email: true, suspendedAt: true } },
        provider: {
          select: {
            id: true,
            displayName: true,
            user: { select: { id: true, name: true, email: true, suspendedAt: true } }
          }
        },
        resolvedByAdmin: { select: { id: true, name: true } },
        booking: {
          select: {
            id: true,
            scheduledAt: true,
            sessionLocation: true,
            status: true,
            priceCents: true,
            currency: true,
            attendanceCodeValidatedAt: true,
            // Raio-X de pagamentos, Rodada 4, Lote 5: prova de que o cliente
            // deu ciência expressa ao início imediato do atendimento (dispensa
            // o prazo de arrependimento do CDC quando o agendamento é em
            // menos de 7 dias) — a única tela onde um admin precisaria disso
            // pra julgar uma contestação nunca mostrava esse campo.
            immediateExecutionAcknowledgedAt: true,
            category: { select: { name: true } },
            completionEvidences: {
              select: { id: true, userId: true, mimeType: true, storageKey: true, imageBase64: true, capturedAt: true }
            },
            chatMessages: {
              orderBy: { createdAt: "asc" },
              take: 500,
              select: { id: true, senderId: true, isSystem: true, content: true, createdAt: true }
            }
          }
        },
        consultancyContract: {
          select: {
            id: true,
            status: true,
            paymentAmountCents: true,
            paymentCapturedAt: true,
            offer: { select: { title: true } }
          }
        },
        presentialPackage: {
          select: { id: true, status: true, cycleAmountCents: true, mode: true, offer: { select: { title: true } } }
        },
        presentialPackageCycle: {
          select: { id: true, cycleIndex: true, amountCents: true, capturedAt: true, periodStart: true, periodEnd: true }
        },
        noShowReport: {
          select: {
            id: true,
            status: true,
            reportReason: true,
            contestReason: true,
            contestDeadlineAt: true,
            contestedAt: true,
            reportedUserId: true,
            reportedByUserId: true
          }
        },
        // Raio-X de pagamentos, Rodada 2, Lote 2: sem isso, o admin decidia
        // uma contestação de ficha (DELIVERY_CONTESTED) sem ver qual ficha
        // era nem quando foi entregue — só "oferta X, valor Y", igual pra
        // ficha #1 ou #12. contextNote (motivo do aluno) já vinha pelo
        // include padrão do Prisma, mas o app nunca exibia.
        //
        // Frente 4 (Criação/entrega/evolução do treino), Lote 3: mesmo
        // depois disso, o admin só via título/data - nunca os exercícios
        // prescritos, exatamente o que precisa julgar se a ficha era
        // vazia/inadequada. Sem isso a contestação de entrega ficava sem
        // lastro probatório nenhum pro admin.
        trainingPlan: {
          select: {
            id: true,
            title: true,
            description: true,
            createdAt: true,
            isActive: true,
            exercises: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                name: true,
                repetitionsSets: true,
                load: true,
                restSeconds: true,
                demoVideoUrl: true,
                exercise: { select: { mediaUrl: true, mediaType: true } }
              }
            }
          }
        }
      }
    });

    if (!disputeCase) {
      throw new AppError("Caso não encontrado.", StatusCodes.NOT_FOUND);
    }

    return disputeCase;
  }

  async resolveCase(adminId: string, caseId: string, input: ResolveDisputeCaseInput) {
    const admin = await this.ensureAdminAccess(adminId);

    const note = input.note.trim();
    if (!note) {
      throw new AppError("Informe o motivo da decisão.", StatusCodes.BAD_REQUEST);
    }

    const disputeCase = await prisma.disputeCase.findUnique({
      where: { id: caseId },
      include: { provider: { select: { userId: true } } }
    });
    if (!disputeCase) {
      throw new AppError("Caso não encontrado.", StatusCodes.NOT_FOUND);
    }
    if (disputeCase.status === DisputeCaseStatus.RESOLVED) {
      throw new AppError("Este caso já foi resolvido.", StatusCodes.BAD_REQUEST);
    }

    // Raio-X de pagamentos, Rodada 3, Lote 1: trava atômica auto-expirável
    // (mesmo idioma de ConsultancyContract.renewalDeliveryLockedAt) contra
    // dois admins resolvendo o mesmo caso ao mesmo tempo — sem isso, os
    // dois passavam pela checagem "já foi resolvido?" acima antes de
    // qualquer um confirmar, podendo gerar reembolso ou dívida duplicados.
    const resolvingStaleThreshold = new Date(Date.now() - 30_000);
    const claimed = await prisma.disputeCase.updateMany({
      where: {
        id: caseId,
        status: DisputeCaseStatus.OPEN,
        OR: [{ resolvingLockedAt: null }, { resolvingLockedAt: { lt: resolvingStaleThreshold } }]
      },
      data: { resolvingLockedAt: new Date() }
    });
    if (claimed.count === 0) {
      throw new AppError(
        "Este caso já está sendo resolvido (ou acabou de ser resolvido). Recarregue e tente novamente.",
        StatusCodes.CONFLICT
      );
    }

    try {
      return await this.doResolveCase(admin, disputeCase, caseId, input, note);
    } catch (error) {
      await prisma.disputeCase
        .updateMany({ where: { id: caseId }, data: { resolvingLockedAt: null } })
        .catch((releaseError) => console.error("Falha ao liberar trava de resolução de disputa:", releaseError));
      throw error;
    }
  }

  private async doResolveCase(
    admin: { id: string },
    disputeCase: NonNullable<Awaited<ReturnType<typeof prisma.disputeCase.findUnique>>> & {
      provider: { userId: string };
    },
    caseId: string,
    input: ResolveDisputeCaseInput,
    note: string
  ) {
    // Raio-X de pagamentos, Rodada 2, Lote 2: RETRY_CAPTURE só se aplica a
    // casos de falha de captura — nunca houve cobrança de verdade (payment
    // fica AUTHORIZED, não CAPTURED), então reembolsar não se aplica; a
    // ação certa é tentar capturar de novo.
    if (input.resolution === "RETRY_CAPTURE") {
      if (disputeCase.type !== "CAPTURE_FAILED") {
        throw new AppError(
          "Tentar capturar de novo só se aplica a casos de falha na captura de um pagamento.",
          StatusCodes.BAD_REQUEST
        );
      }
      if (!disputeCase.bookingId) {
        throw new AppError("Este caso não tem um agendamento vinculado para capturar.", StatusCodes.BAD_REQUEST);
      }
      try {
        await this.paymentService.capturePaymentForBooking(disputeCase.bookingId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida";
        throw new AppError(
          `A nova tentativa de captura também falhou (${message}). O caso continua em aberto.`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    // Frente 6 (segunda camada), Lote 2: NO_SHOW_CONTESTED e
    // CONFIRMATION_DEADLOCK existem justamente porque o pagamento nunca foi
    // capturado (fica AUTHORIZED — reservado no cartão — até revisão
    // manual). A lógica abaixo (REFUNDED estorna via mpRefund, DENIED não
    // mexe no pagamento) foi escrita pra disputas com pagamento JÁ
    // capturado (chargeback, entrega contestada, cobrança automática) —
    // aplicada a estes dois tipos, "REFUNDED" tentava estornar uma cobrança
    // que nunca existiu (falha na Mercado Pago) e "DENIED" nunca capturava
    // o pagamento a favor do profissional. Aqui o sentido é invertido:
    // REFUNDED = liberar a pré-autorização sem cobrar; DENIED = capturar de
    // verdade, pagando o profissional pela primeira vez.
    const isUncapturedDisputeType =
      disputeCase.type === "NO_SHOW_CONTESTED" || disputeCase.type === "CONFIRMATION_DEADLOCK";

    if (isUncapturedDisputeType && (input.resolution === "REFUNDED" || input.resolution === "DENIED")) {
      if (!disputeCase.bookingId) {
        throw new AppError("Este caso não tem um agendamento vinculado.", StatusCodes.BAD_REQUEST);
      }
      if (
        input.resolution === "REFUNDED" &&
        input.amountCents !== undefined &&
        input.amountCents !== disputeCase.amountCents
      ) {
        throw new AppError(
          "Este caso ainda não teve nenhuma cobrança — só é possível liberar o valor reservado por inteiro, não parcialmente.",
          StatusCodes.BAD_REQUEST
        );
      }
      try {
        if (input.resolution === "REFUNDED") {
          await this.paymentService.cancelPaymentForBooking(disputeCase.bookingId);
          await restoreFlexibleCreditForBooking(prisma, disputeCase.bookingId);
        } else {
          // cancelPaymentForBooking já é no-op quando o booking nunca teve um
          // Payment (ex.: sessão paga com crédito de pacote) — capturePayment
          // ForBooking lança erro nesse mesmo caso porque também é usado no
          // retry de captura (CAPTURE_FAILED), onde "sem payment" é um erro
          // real. Aqui, pra manter a mesma tolerância do lado REFUNDED, só
          // chama a captura se de fato existir um Payment pra capturar.
          const existingPayment = await prisma.payment.findUnique({ where: { bookingId: disputeCase.bookingId } });
          if (existingPayment) {
            await this.paymentService.capturePaymentForBooking(disputeCase.bookingId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida";
        throw new AppError(
          `Não foi possível ${input.resolution === "REFUNDED" ? "liberar a pré-autorização" : "capturar o pagamento"} (${message}). O caso continua em aberto.`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    let resolvedAmountCents: number | null = null;

    if (input.resolution === "REFUNDED") {
      const amountCents = input.amountCents ?? disputeCase.amountCents;
      if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > disputeCase.amountCents) {
        throw new AppError("Valor de reembolso inválido.", StatusCodes.BAD_REQUEST);
      }
      if (!isUncapturedDisputeType) {
        if (!disputeCase.mpPaymentId) {
          throw new AppError("Este caso não tem um pagamento vinculado para reembolsar.", StatusCodes.BAD_REQUEST);
        }

        const isFullRefund = amountCents === disputeCase.amountCents;
        await mpRefund.create({
          payment_id: disputeCase.mpPaymentId,
          body: isFullRefund ? {} : { amount: amountCents / 100 },
          // Frente 2 (segunda camada), Lote 4: chave estável por caso — a
          // trava resolvingLockedAt (acima) já impede dois admins resolvendo
          // ao mesmo tempo; isto protege contra um retry de rede da mesma
          // chamada duplicar o reembolso no gateway.
          requestOptions: { idempotencyKey: `dispute:${caseId}:refund` }
        });
      }
      resolvedAmountCents = amountCents;
    }

    if (input.resolution === "RETRY_CAPTURE") {
      // Representa o valor do caso como resolvido (capturado), pro histórico
      // e pra notificação — não é um reembolso, mas usa o mesmo campo.
      resolvedAmountCents = disputeCase.amountCents;
    }

    let clientDebtCents: number | null = null;
    if (input.resolution === "DENIED" && input.chargeClientDebtCents !== undefined) {
      // Raio-X de pagamentos, Rodada 4, Lote 12: mesmo teto que amountCents já
      // tem no fluxo de reembolso (linha acima) — sem isso, um erro de
      // digitação do admin (um zero a mais) virava uma dívida real e
      // desproporcional pro aluno, sem nenhum valor histórico do próprio caso
      // pra comparar.
      if (
        !Number.isInteger(input.chargeClientDebtCents) ||
        input.chargeClientDebtCents <= 0 ||
        input.chargeClientDebtCents > disputeCase.amountCents
      ) {
        throw new AppError("Valor de pendência do aluno inválido.", StatusCodes.BAD_REQUEST);
      }
      clientDebtCents = input.chargeClientDebtCents;
    }

    const resolvedAt = new Date();
    const storedResolution: DisputeCaseResolution =
      input.resolution === "RETRY_CAPTURE" ? "CAPTURED" : input.resolution;

    const updated = await prisma.$transaction(async (tx) => {
      const resolvedCase = await tx.disputeCase.update({
        where: { id: caseId },
        data: {
          status: DisputeCaseStatus.RESOLVED,
          resolution: storedResolution,
          resolvedAmountCents,
          resolutionNote: note,
          resolvedByAdminId: admin.id,
          resolvedAt
        }
      });

      if (resolvedCase.noShowReportId) {
        await tx.noShowReport.update({
          where: { id: resolvedCase.noShowReportId },
          data: { status: "RESOLVED", resolvedAt }
        });
      }

      // Reembolso resolvido == pagamento ja estava capturado e repassado
      // (reembolso so existe pra pagamento capturado - pre-autorizacao usa
      // cancelamento, nao reembolso), entao o personal ja recebeu esse
      // valor: a divida nasce automatica aqui, sem acao extra do admin.
      // Frente 6 (segunda camada), Lote 2: para NO_SHOW_CONTESTED/
      // CONFIRMATION_DEADLOCK essa premissa é falsa — o profissional nunca
      // recebeu nada (payment ficou AUTHORIZED), então nada aqui se aplica;
      // cancelPaymentForBooking (chamado acima) já deixou o Payment como
      // CANCELED e já notificou as partes.
      if (input.resolution === "REFUNDED" && resolvedAmountCents !== null && !isUncapturedDisputeType) {
        // Raio-X de pagamentos, Rodada 5, Lote 3: o profissional nunca
        // recebeu o valor bruto da venda — recebeu só o líquido (split),
        // já que a comissão da plataforma ficou retida na venda original.
        // Cobrar o bruto de volta faz a plataforma terminar com mais
        // dinheiro do que a venda tinha (bruto de volta + comissão já
        // embolsada, nunca revertida).
        await tx.debtRecord.create({
          data: {
            disputeCaseId: caseId,
            debtorType: "PROVIDER",
            providerId: disputeCase.providerId,
            amountCents: providerSplitAmount(resolvedAmountCents),
            reason: note,
            status: "NOTIFIED"
          }
        });

        // Raio-X de pagamentos, Rodada 2, Lote 2: antes o Payment/contrato
        // local nunca era atualizado ao resolver a disputa — o admin
        // estornava de verdade no Mercado Pago, mas o registro local
        // continuava CAPTURED, contaminando qualquer relatório/tela que
        // leia esse status depois.
        const isFullRefund = resolvedAmountCents === disputeCase.amountCents;
        if (disputeCase.bookingId) {
          await tx.payment.updateMany({
            where: { bookingId: disputeCase.bookingId },
            data: {
              status: isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
              refundedAt: resolvedAt,
              refundedAmountCents: resolvedAmountCents
            }
          });
          // Frente 4 (Criação/entrega/evolução do treino), Lote 1: reembolso
          // total decidido pelo admin também devolve o crédito da sessão se
          // for de um pacote de sessões avulsas - mesmo raciocínio de
          // qualquer outro cancelamento/estorno dessa sessão.
          if (isFullRefund) {
            await restoreFlexibleCreditForBooking(tx, disputeCase.bookingId);
            // Frente 5 (Descoberta, agendamento e agenda), Lote 4: rating do
            // profissional nunca era corrigido quando o admin resolvia uma
            // disputa com reembolso total de uma sessão já avaliada — a
            // review continuava contando pra sempre.
            await recalculateProviderRatingAfterRefund(disputeCase.bookingId, tx);
          }
        }
        // Épico de Frentes, Frente 12, Lote 1: reembolso PARCIAL de
        // consultoria/renovação virava REFUNDED igual a um reembolso total -
        // paymentStatus/refundedAt sozinhos não davam pra saber "quanto"
        // voltou, então qualquer consulta que filtrasse por CAPTURED (ou
        // refundedAt: null) via a receita inteira desaparecer, em vez de só
        // a fração reembolsada.
        if (disputeCase.consultancyContractId) {
          await tx.consultancyContract.updateMany({
            where: { id: disputeCase.consultancyContractId },
            data: {
              paymentStatus: isFullRefund ? ConsultancyPaymentStatus.REFUNDED : ConsultancyPaymentStatus.PARTIALLY_REFUNDED,
              refundedAt: resolvedAt,
              refundedAmountCents: resolvedAmountCents
            }
          });
        }
        // Épico de Frentes, Frente 7, Lote 2: pacote presencial (cycle) e
        // renovação de ficha (trainingPlan) não tinham nenhum jeito de
        // registrar que uma disputa vinculada foi reembolsada - a receita
        // continuava contada pra sempre nos relatórios financeiros, mesmo
        // já tendo voltado pro cliente.
        if (disputeCase.presentialPackageCycleId) {
          await tx.presentialPackageCycle.updateMany({
            where: { id: disputeCase.presentialPackageCycleId },
            data: { refundedAt: resolvedAt, refundedAmountCents: resolvedAmountCents }
          });
        }
        if (disputeCase.trainingPlanId) {
          await tx.trainingPlan.updateMany({
            where: { id: disputeCase.trainingPlanId },
            data: { refundedAt: resolvedAt, refundedAmountCents: resolvedAmountCents }
          });
        }
      }

      if (clientDebtCents !== null) {
        await tx.debtRecord.create({
          data: {
            disputeCaseId: caseId,
            debtorType: "CLIENT",
            clientId: disputeCase.clientId,
            amountCents: clientDebtCents,
            reason: note,
            status: "NOTIFIED"
          }
        });
      }

      return resolvedCase;
    });

    void writeAdminAuditLog({
      adminId: admin.id,
      action: "DISPUTE_CASE_RESOLVED",
      targetType: "DISPUTE_CASE",
      targetId: caseId,
      metadata: { resolution: input.resolution, resolvedAmountCents, type: disputeCase.type }
    });

    // Frente 6 (segunda camada), Lote 2: pra NO_SHOW_CONTESTED/
    // CONFIRMATION_DEADLOCK nunca houve cobrança de verdade — "reembolsado"
    // e "descontado do próximo repasse" são afirmações falsas nesse caso
    // (o valor só estava reservado, nunca foi repassado ao profissional).
    const clientMessage =
      input.resolution === "REFUNDED"
        ? isUncapturedDisputeType
          ? `Seu caso foi resolvido: a reserva de R$ ${formatCents(resolvedAmountCents!)} no seu cartão foi liberada — você não será cobrado por esta sessão. Motivo: ${note}`
          : `Seu caso foi resolvido: você foi reembolsado em R$ ${formatCents(resolvedAmountCents!)}. Motivo: ${note}`
        : input.resolution === "RETRY_CAPTURE"
          ? `Seu caso foi resolvido: a cobrança pendente foi confirmada com sucesso. Motivo: ${note}`
          : isUncapturedDisputeType
            ? `Seu caso foi resolvido: a cobrança de R$ ${formatCents(disputeCase.amountCents)} pela sessão foi confirmada. Motivo: ${note}`
            : clientDebtCents !== null
              ? `Seu caso foi resolvido: o reembolso não foi aprovado. Motivo: ${note} Além disso, foi identificado que você já havia recebido R$ ${formatCents(clientDebtCents)} indevidamente antes desta disputa — enquanto essa pendência não for regularizada, novas compras ficarão bloqueadas.`
              : `Seu caso foi resolvido: o reembolso não foi aprovado. Motivo: ${note}`;

    const providerMessage =
      input.resolution === "REFUNDED"
        ? isUncapturedDisputeType
          ? `O caso foi resolvido: a reserva no cartão do cliente foi liberada — esta sessão não será cobrada nem repassada a você. Motivo: ${note}`
          : `O caso foi resolvido: o cliente foi reembolsado em R$ ${formatCents(resolvedAmountCents!)}. Motivo: ${note} O valor que você recebeu por essa venda (R$ ${formatCents(providerSplitAmount(resolvedAmountCents!))}) será descontado do seu próximo repasse.`
        : input.resolution === "RETRY_CAPTURE"
          ? `O caso foi resolvido: a cobrança pendente foi confirmada com sucesso e o repasse segue normalmente. Motivo: ${note}`
          : isUncapturedDisputeType
            ? `O caso foi resolvido a seu favor: a cobrança de R$ ${formatCents(disputeCase.amountCents)} pela sessão foi confirmada e o repasse segue normalmente. Motivo: ${note}`
            : `O caso foi resolvido: o pedido de reembolso do cliente não foi aprovado. Motivo: ${note}`;

    void this.notificationService
      .sendToUsers([disputeCase.clientId], {
        preferenceType: "PAYMENTS",
        title: "Seu caso foi resolvido",
        body: clientMessage,
        data: { type: "DISPUTE_CASE_RESOLVED", caseId }
      })
      .catch((error) => console.error("Falha ao notificar cliente sobre resolução de disputa:", error));

    void this.notificationService
      .sendToUsers([disputeCase.provider.userId], {
        preferenceType: "PAYMENTS",
        title: "Um caso foi resolvido",
        body: providerMessage,
        // Frente 3 (segunda camada), Lote 7: sem esse sinalizador, a
        // notificação levava sempre pra tela Financeiro genérica, que não
        // menciona a dívida em lugar nenhum — o profissional só descobria
        // o motivo do desconto se fosse procurar manualmente em
        // Configurações > Pendências. Com REFUNDED, um DebtRecord PROVIDER
        // acabou de ser criado logo acima (ver transação); a notificação
        // agora carrega isso pra o app rotear direto pra tela certa.
        data: { type: "DISPUTE_CASE_RESOLVED", caseId, providerDebtCreated: input.resolution === "REFUNDED" }
      })
      .catch((error) => console.error("Falha ao notificar profissional sobre resolução de disputa:", error));

    return updated;
  }
}
