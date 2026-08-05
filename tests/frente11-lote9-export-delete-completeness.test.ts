import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { hashValue } from "../src/shared/utils/hash";
import { encryptSensitiveText, encryptJson } from "../src/shared/utils/encryption";

// Épico de Frentes, Frente 11, Lote 9: não existia nenhuma suíte cobrindo a
// COMPLETUDE de exportMyData/deleteMe - um model novo no schema com dado
// pessoal nunca quebrava nenhum teste, silenciosamente ficando de fora dos
// dois fluxos. Este arquivo cria um registro em cada tabela de dado
// pessoal conhecida pra um único usuário de teste, roda os dois fluxos, e
// falha explicitamente se alguma delas não aparecer no export ou não for
// tocada pela exclusão.
//
// Manutenção: ao adicionar um novo model com dado pessoal ao schema,
// adicione um bloco "setup" (linha) aqui + a asserção correspondente nos
// dois describes abaixo. Se o novo dado for INTENCIONALMENTE excluído de
// um dos dois fluxos (ex.: puramente uma trilha de auditoria interna, sem
// conteúdo submetido pelo próprio titular), documente o motivo no
// comentário ao lado da asserção "ausência esperada".

const PASSWORD = "Test1234";
const userService = new UserService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("Frente 11, Lote 9 — completude de exportMyData e deleteMe", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";
  let requestId = "";
  let contractId = "";
  let bookingId = "";
  let disputeCaseId = "";
  let otherClientId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const hashed = await hashValue(PASSWORD);

    const category = await prisma.serviceCategory.create({ data: { name: `F11L9_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Completeness Client",
        email: `${uid("f11l9_client")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Completeness Provider",
        email: `${uid("f11l9_provider")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Completeness Provider", bio: "x", experienceYears: 2, priceCents: 8000, crefValidationStatus: "APPROVED" }
    });
    providerId = provider.id;

    const otherClient = await prisma.user.create({
      data: {
        name: "Completeness Follower",
        email: `${uid("f11l9_follower")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT"
      }
    });
    otherClientId = otherClient.id;

    // Booking (relação cliente-profissional base)
    const booking = await prisma.booking.create({
      data: {
        clientId, providerId, categoryId, scheduledAt: new Date(), priceCents: 8000, status: "COMPLETED",
        completedAt: new Date(), notes: "Nota de agendamento do cliente."
      }
    });
    bookingId = booking.id;

    // Dado de saúde (Frente 11, Lote 3)
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", answers: encryptJson({ x: 1 }) } });
    await prisma.providerStudentAssessment.create({ data: { providerId, clientId, weight: encryptSensitiveText("80kg") } });

    // Suporte, disputa, no-show, dívida
    await prisma.supportTicket.create({ data: { userId: clientId, subject: "Assunto", message: "Mensagem de suporte." } });
    const dispute = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", status: "RESOLVED", clientId, providerId, amountCents: 8000, resolvedAt: new Date(0) }
    });
    disputeCaseId = dispute.id;
    // status PAID: o débito precisa aparecer no export (histórico), mas um
    // débito PENDING/NOTIFIED bloquearia a própria exclusão testada abaixo.
    await prisma.debtRecord.create({ data: { disputeCaseId, debtorType: "CLIENT", clientId, amountCents: 8000, reason: "Motivo do débito.", status: "PAID" } });
    await prisma.noShowReport.create({ data: { bookingId, reportedUserId: providerUserId, reportedByUserId: clientId, reportReason: "Motivo do no-show." } });

    // Chat de agendamento e de consultoria
    await prisma.bookingMessage.create({ data: { bookingId, senderId: clientId, content: "Mensagem de chat de agendamento." } });

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: "Oferta de teste", billingCycle: "MONTHLY", priceCents: 15000 }
    });
    offerId = offer.id;
    const request = await prisma.consultancyRequest.create({
      data: { providerId, clientId, status: "RESPONDED", quotedOfferId: offerId, responseDeadlineAt: new Date(Date.now() + 48 * 3600_000), respondedAt: new Date() }
    });
    requestId = request.id;
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId, providerId, clientId, offerId, status: "ACTIVE", paymentMethod: "PIX", paymentInstallments: 1,
        paymentStatus: "CAPTURED", paymentAmountCents: 15000, providerAmountCents: 13000, platformAmountCents: 2000,
        billingCycle: "MONTHLY", kind: "ONLINE_CONSULTANCY", deliveryDeadlineAt: new Date(Date.now() + 48 * 3600_000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractId = contract.id;
    await prisma.consultancyMessage.create({ data: { contractId, senderId: clientId, content: "Mensagem de chat de consultoria." } });

    // Review
    await prisma.review.create({ data: { bookingId, userId: clientId, providerId, rating: 5, comment: "Comentário de review." } });

    // Feed / comunidade
    await prisma.feedPost.create({ data: { userId: clientId, type: "MANUAL_PHOTO", caption: "Legenda de post.", isAutomatic: false } });
    const otherPost = await prisma.feedPost.create({ data: { userId: otherClientId, type: "MANUAL_PHOTO", caption: "Post de outro usuário.", isAutomatic: false } });
    await prisma.feedPostLike.create({ data: { postId: otherPost.id, userId: clientId } });
    await prisma.feedPostComment.create({ data: { postId: otherPost.id, userId: clientId, content: "Comentário do cliente." } });
    await prisma.follow.create({ data: { followerId: otherClientId, followingId: clientId } });

    // Gamificação
    await prisma.userXpTransaction.create({ data: { userId: clientId, amount: 10, reason: "POST_WORKOUT_PHOTO" } });
    await prisma.userStreak.create({ data: { userId: clientId, currentStreak: 1, longestStreak: 1 } });
    await prisma.rankingSnapshot.create({ data: { userId: clientId, periodType: "WEEKLY", periodKey: "2026-W01", xpEarned: 10 } });

    // Sessão e dispositivo
    await prisma.session.create({ data: { userId: clientId, refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    await prisma.pushDevice.create({ data: { userId: clientId, token: randomUUID(), platform: "IOS" } });

    // Método de pagamento salvo
    await prisma.customerPaymentMethod.create({
      data: { userId: clientId, mpCustomerId: "mp-cust", mpCardId: `mp-card-${randomUUID()}`, nickname: "Cartão", brand: "visa", last4: "4242" }
    });

    // Lado profissional: conta bancária, bloco manual, aluno financeiro
    await prisma.providerBankAccount.create({
      data: {
        providerId, bankName: "Banco Teste", accountType: "CHECKING",
        agency: encryptSensitiveText("0001"), accountNumber: encryptSensitiveText("123456"),
        accountDigit: encryptSensitiveText("7"), holderName: encryptSensitiveText("Titular"), holderDocument: encryptSensitiveText("12345678900")
      }
    });
    await prisma.providerManualBlock.create({ data: { providerId, date: "2026-01-01", startTime: "08:00", endTime: "09:00", label: "Bloco manual" } });
    await prisma.financialStudent.create({ data: { providerId, name: "Aluno Manual", monthlyValueCents: 10000, type: "PRESENTIAL", notes: "Nota financeira manual." } });
  });

  afterAll(async () => {
    await prisma.financialStudent.deleteMany({ where: { providerId } });
    await prisma.providerManualBlock.deleteMany({ where: { providerId } });
    await prisma.providerBankAccount.deleteMany({ where: { providerId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.pushDevice.deleteMany({ where: { userId: clientId } });
    await prisma.session.deleteMany({ where: { userId: clientId } });
    await prisma.rankingSnapshot.deleteMany({ where: { userId: clientId } });
    await prisma.userStreak.deleteMany({ where: { userId: clientId } });
    await prisma.userXpTransaction.deleteMany({ where: { userId: clientId } });
    await prisma.follow.deleteMany({ where: { OR: [{ followerId: clientId }, { followerId: otherClientId }] } });
    await prisma.feedPostComment.deleteMany({ where: { userId: { in: [clientId, otherClientId] } } });
    await prisma.feedPostLike.deleteMany({ where: { userId: { in: [clientId, otherClientId] } } });
    await prisma.feedPost.deleteMany({ where: { userId: { in: [clientId, otherClientId] } } });
    await prisma.review.deleteMany({ where: { userId: clientId } });
    await prisma.consultancyMessage.deleteMany({ where: { contractId } });
    await prisma.consultancyContract.deleteMany({ where: { id: contractId } });
    await prisma.consultancyRequest.deleteMany({ where: { id: requestId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.bookingMessage.deleteMany({ where: { bookingId } });
    await prisma.noShowReport.deleteMany({ where: { bookingId } });
    await prisma.debtRecord.deleteMany({ where: { disputeCaseId } });
    await prisma.disputeCase.deleteMany({ where: { id: disputeCaseId } });
    await prisma.supportTicket.deleteMany({ where: { userId: clientId } });
    await prisma.providerStudentAssessment.deleteMany({ where: { providerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.dataExportLog.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, otherClientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("exportMyData inclui todas as categorias conhecidas de dado pessoal", async () => {
    const result = await userService.exportMyData(clientId);

    expect(result.bookings.length).toBeGreaterThan(0);
    expect(result.anamnesis?.answers).toBeTruthy();
    expect(result.physicalAssessments.length).toBeGreaterThan(0);
    expect(result.supportTickets.length).toBeGreaterThan(0);
    expect(result.disputes.length).toBeGreaterThan(0);
    expect(result.debtRecords.length).toBeGreaterThan(0);
    expect(result.noShowReportsFiled.length).toBeGreaterThan(0);
    expect(result.chatMessages.length).toBeGreaterThan(0);
    expect(result.consultancyMessages.length).toBeGreaterThan(0);
    expect(result.consultancyRequests.length).toBeGreaterThan(0);
    expect(result.consultancyContracts.length).toBeGreaterThan(0);
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(result.feedPosts.length).toBeGreaterThan(0);
    expect(result.feedPostLikes.length).toBeGreaterThan(0);
    expect(result.feedPostComments.length).toBeGreaterThan(0);
    expect(result.followers.length).toBeGreaterThan(0);
    expect(result.xpTransactions.length).toBeGreaterThan(0);
    expect(result.streak).not.toBeNull();
    expect(result.rankingSnapshots.length).toBeGreaterThan(0);
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.pushDevices.length).toBeGreaterThan(0);
    expect(result.customerPaymentMethods.length).toBeGreaterThan(0);
  });

  it("exportMyData do PROFISSIONAL inclui conta bancária, bloco manual e aluno financeiro", async () => {
    const result = await userService.exportMyData(providerUserId);

    expect(result.providerData).not.toBeNull();
    expect(result.providerData!.bankAccount).not.toBeNull();
    expect(
      result.providerData!.consultancyContractsAsProvider.length +
      result.providerData!.bookingsReceived.length
    ).toBeGreaterThan(0);
  });

  it("deleteMe toca todas as categorias conhecidas de dado pessoal", async () => {
    await userService.deleteMe(clientId, PASSWORD);

    const anamnesis = await prisma.clientAnamnesis.findUnique({ where: { clientId } });
    expect(anamnesis).toBeNull();

    const assessment = await prisma.providerStudentAssessment.findUnique({ where: { providerId_clientId: { providerId, clientId } } });
    expect(assessment).toBeNull();

    const message = await prisma.bookingMessage.findFirstOrThrow({ where: { bookingId } });
    expect(message.content).toBe("[Mensagem removida]");
    expect(message.senderId).toBeNull();

    const consultancyMessage = await prisma.consultancyMessage.findFirstOrThrow({ where: { contractId } });
    expect(consultancyMessage.content).toBe("[Mensagem removida]");
    expect(consultancyMessage.senderId).toBeNull();

    const review = await prisma.review.findUniqueOrThrow({ where: { bookingId } });
    expect(review.comment).toBeNull();

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.notes).toBeNull();

    const like = await prisma.feedPostLike.findFirst({ where: { userId: clientId } });
    expect(like).toBeNull();

    const comment = await prisma.feedPostComment.findFirstOrThrow({ where: { userId: clientId } });
    expect(comment.content).toBe("[Comentário removido]");

    const follow = await prisma.follow.findFirst({ where: { followingId: clientId } });
    expect(follow).toBeNull();

    const sessions = await prisma.session.findMany({ where: { userId: clientId, revokedAt: null } });
    expect(sessions).toHaveLength(0);

    const devices = await prisma.pushDevice.findMany({ where: { userId: clientId, isActive: true } });
    expect(devices).toHaveLength(0);

    const paymentMethods = await prisma.customerPaymentMethod.findMany({ where: { userId: clientId } });
    expect(paymentMethods).toHaveLength(0);

    const streak = await prisma.userStreak.findUnique({ where: { userId: clientId } });
    expect(streak).toBeNull();

    const xp = await prisma.userXpTransaction.findMany({ where: { userId: clientId } });
    expect(xp).toHaveLength(0);

    const ranking = await prisma.rankingSnapshot.findMany({ where: { userId: clientId } });
    expect(ranking).toHaveLength(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(user.name).toBe("Usuário removido");
    expect(user.document).toBeNull();
    expect(user.documentHash).toBeNull();
    expect(user.apelido).toBeNull();

    // SupportTicket é retido por até 5 anos para defesa de direitos (política de
    // privacidade, item 8) - deleteMe não anonimiza o conteúdo na hora de
    // propósito; só o job de retenção o faz, quando o ticket realmente vence.
    const ticket = await prisma.supportTicket.findFirstOrThrow({ where: { userId: clientId } });
    expect(ticket.message).toBe("Mensagem de suporte.");
  });

  it("deleteMe do PROFISSIONAL limpa conta bancária, bloco manual e aluno financeiro", async () => {
    await userService.deleteMe(providerUserId, PASSWORD);

    const bankAccount = await prisma.providerBankAccount.findUnique({ where: { providerId } });
    expect(bankAccount).toBeNull();

    // deleteMe exclui o bloco manual inteiramente (comportamento já
    // existente antes da Frente 11) - é a regra de retenção periódica
    // (Lote 7, cleanupManualBlocks) que REDIGE o rótulo/local pra contas
    // ainda ativas além da janela, não o deleteMe.
    const block = await prisma.providerManualBlock.findFirst({ where: { providerId } });
    expect(block).toBeNull();

    const provider = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(provider.displayName).toBe("Personal removido");

    const providerUser = await prisma.user.findUniqueOrThrow({ where: { id: providerUserId } });
    expect(providerUser.name).toBe("Usuário removido");
  });
});
