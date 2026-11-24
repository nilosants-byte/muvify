import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// "Usuário B tentando ler ou mexer no dado do usuário A" (IDOR), rota por
// rota, em todas as rotas com id que não tinham esse teste.
//
// Regras pra o teste não passar por engano:
// - o intruso tem o MESMO papel e as mesmas condições do dono (perfil, CREF
//   aprovado, e-mail verificado). Assim um 403 vem da checagem de dono, não
//   de "você não é profissional";
// - o corpo de cada pedido é válido (senão a rota devolveria 400 antes de
//   olhar quem é o dono, e o teste não provaria nada);
// - só 403 ou 404 contam como bloqueio; e no fim, nenhum dado do dono pode
//   ter mudado;
// - nas leituras, o próprio dono consegue ler (prova que o 404 do intruso não
//   é só "esse dado não existe pra ninguém").

type Who = "clientA" | "clientB" | "providerA" | "providerB";

const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const tokens = {} as Record<Who, string>;
const userIds = {} as Record<Who, string>;
const profileIds = {} as Record<"providerA" | "providerB", string>;
const ids: Record<string, string> = {};

type Method = "get" | "post" | "put" | "patch" | "delete";
type Body = Record<string, unknown>;
// body como função: os ids só existem depois do beforeAll.
type Case = { name: string; as: Who; method: Method; url: () => string; body?: Body | (() => Body) };

const exercise = { name: "Agachamento livre", repetitionsSets: "3x12", load: "20kg" };
const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
// Código de presença VERDADEIRO do agendamento do clientA: o intruso tenta usar
// o código certo (o ataque real), não um chute.
const attendanceCode = "482913";
let attendanceQrToken = "";

async function register(who: Who, role: "CLIENT" | "PROVIDER") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      name: `Idor ${who}`,
      email: `idor_${who}_${runId}@test.com`,
      password: "Test1234",
      phone: `119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      ...(role === "PROVIDER" ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  if (res.status !== 201) throw new Error(`cadastro ${who}: ${res.status} ${JSON.stringify(res.body)}`);
  tokens[who] = res.body.accessToken;
  userIds[who] = res.body.user.id;
  await prisma.user.update({ where: { id: userIds[who] }, data: { emailVerifiedAt: new Date() } });
}

async function createProviderProfile(who: "providerA" | "providerB") {
  const profile = await prisma.providerProfile.create({
    data: {
      userId: userIds[who],
      displayName: `Idor ${who}`,
      bio: "Perfil de teste de acesso entre usuários",
      experienceYears: 3,
      priceCents: 10_000,
      crefValidationStatus: "APPROVED"
    }
  });
  profileIds[who] = profile.id;
}

function send(c: Pick<Case, "as" | "method" | "body">, url: string) {
  const req = request(app)[c.method](url).set("Authorization", `Bearer ${tokens[c.as]}`);
  if (!c.body) return req;
  return req.send(typeof c.body === "function" ? c.body() : c.body);
}

// Foto do estado de cada dado do dono antes das tentativas do intruso.
async function ownerDataSnapshot() {
  const strip = (row: Record<string, unknown> | null) => {
    if (!row) return null;
    const { updatedAt: _ignored, ...rest } = row;
    return rest;
  };
  const rows = await Promise.all([
    prisma.booking.findUnique({ where: { id: ids.booking } }),
    prisma.payment.findUnique({ where: { id: ids.payment } }),
    prisma.customerPaymentMethod.findUnique({ where: { id: ids.card } }),
    prisma.user.findUnique({
      where: { id: userIds.clientA },
      select: { mpCustomerId: true, mpDefaultCardId: true }
    }),
    prisma.debtRecord.findUnique({ where: { id: ids.debt } }),
    prisma.presentialPackage.findUnique({ where: { id: ids.package } }),
    prisma.userNotification.findUnique({ where: { id: ids.notification } }),
    prisma.review.findUnique({ where: { id: ids.review } }),
    prisma.providerServiceOffer.findUnique({ where: { id: ids.consultancyOffer } }),
    prisma.consultancyRequest.findUnique({ where: { id: ids.request } }),
    prisma.consultancyRequest.findUnique({ where: { id: ids.quotedRequest } }),
    prisma.consultancyContract.findUnique({ where: { id: ids.contract } }),
    prisma.trainingPlan.findUnique({ where: { id: ids.trainingPlan } }),
    prisma.trainingPlanCompletion.count({ where: { trainingPlanId: ids.trainingPlan } }),
    prisma.externalStudentInvite.findUnique({ where: { id: ids.invite } }),
    prisma.consultancyMessage.count({ where: { contractId: ids.contract } }),
    prisma.consultancyMessageReport.count({ where: { messageId: ids.consultancyMessage } }),
    prisma.bookingMessage.count({ where: { bookingId: ids.booking } }),
    prisma.bookingMessageReport.count({ where: { messageId: ids.bookingMessage } }),
    prisma.noShowReport.findUnique({ where: { id: ids.noShow } }),
    prisma.noShowReport.count({ where: { bookingId: ids.booking } }),
    prisma.disputeCase.count({ where: { clientId: userIds.clientA } }),
    prisma.providerCalendarEvent.findUnique({ where: { id: ids.calendarEvent } }),
    prisma.providerStudentAssessment.count({ where: { clientId: userIds.clientA } }),
    prisma.availability.findUnique({ where: { id: ids.availability } }),
    prisma.providerManualBlock.findUnique({ where: { id: ids.manualBlock } }),
    prisma.feedPostComment.findUnique({ where: { id: ids.comment } }),
    prisma.financialStudent.findUnique({ where: { id: ids.financialStudent } }),
    prisma.financialIncome.findUnique({ where: { id: ids.income } }),
    prisma.financialExpense.findUnique({ where: { id: ids.expense } }),
    prisma.serviceCategory.findUnique({ where: { id: ids.inactiveCategory } })
  ]);
  return rows.map((row) => (typeof row === "number" ? row : strip(row as Record<string, unknown> | null)));
}

let snapshotBefore: unknown[] = [];

beforeAll(async () => {
  await register("clientA", "CLIENT");
  await register("clientB", "CLIENT");
  await register("providerA", "PROVIDER");
  await register("providerB", "PROVIDER");
  await createProviderProfile("providerA");
  await createProviderProfile("providerB");

  const providerA = profileIds.providerA;
  const clientA = userIds.clientA;

  const category = await prisma.serviceCategory.create({ data: { name: `Idor ${runId}`, description: "x" } });
  ids.category = category.id;
  const inactiveCategory = await prisma.serviceCategory.create({
    data: { name: `Idor inativa ${runId}`, description: "x", active: false }
  });
  ids.inactiveCategory = inactiveCategory.id;

  // Agenda presencial entre clientA e providerA
  const booking = await prisma.booking.create({
    data: {
      clientId: clientA,
      providerId: providerA,
      categoryId: category.id,
      scheduledAt: inOneDay(),
      priceCents: 10_000,
      status: "CONFIRMED",
      attendanceCode,
      attendanceCodeGeneratedAt: new Date(),
      attendanceCodeExpiresAt: inOneDay()
    }
  });
  ids.booking = booking.id;
  attendanceQrToken = (
    new BookingService() as unknown as {
      buildAttendanceQrToken(bookingId: string, code: string, expiresAt: Date): string;
    }
  ).buildAttendanceQrToken(booking.id, attendanceCode, inOneDay());
  ids.payment = (
    await prisma.payment.create({ data: { bookingId: booking.id, amountCents: 10_000, method: "PIX" } })
  ).id;
  ids.bookingMessage = (
    await prisma.bookingMessage.create({ data: { bookingId: booking.id, senderId: clientA, content: "Oi" } })
  ).id;
  ids.noShow = (
    await prisma.noShowReport.create({
      data: { bookingId: booking.id, reportedUserId: clientA, reportedByUserId: userIds.providerA }
    })
  ).id;

  ids.card = (
    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientA,
        mpCustomerId: `cus_${runId}`,
        mpCardId: `card_${runId}`,
        nickname: "Cartão do A",
        brand: "visa",
        last4: "4242",
        isDefault: true
      }
    })
  ).id;

  const dispute = await prisma.disputeCase.create({
    data: { type: "NO_SHOW_CONTESTED", clientId: clientA, providerId: providerA, amountCents: 5_000 }
  });
  ids.debt = (
    await prisma.debtRecord.create({
      data: {
        disputeCaseId: dispute.id,
        debtorType: "CLIENT",
        clientId: clientA,
        amountCents: 5_000,
        reason: "Teste"
      }
    })
  ).id;

  const presentialOffer = await prisma.providerServiceOffer.create({
    data: { providerId: providerA, kind: "PRESENTIAL", title: "Pacote", billingCycle: "MONTHLY", priceCents: 40_000 }
  });
  ids.package = (
    await prisma.presentialPackage.create({
      data: {
        providerId: providerA,
        clientId: clientA,
        offerId: presentialOffer.id,
        categoryId: category.id,
        mode: "FIXED_RECURRING",
        cycleAmountCents: 40_000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4
      }
    })
  ).id;

  ids.notification = (
    await prisma.userNotification.create({ data: { userId: clientA, title: "Aviso", body: "Só do A" } })
  ).id;
  ids.review = (
    await prisma.review.create({ data: { userId: clientA, providerId: providerA, rating: 5, bookingId: booking.id } })
  ).id;

  // Consultoria online entre clientA e providerA
  const consultancyOffer = await prisma.providerServiceOffer.create({
    data: {
      providerId: providerA,
      kind: "ONLINE_CONSULTANCY",
      title: "Consultoria",
      billingCycle: "MONTHLY",
      priceCents: 20_000
    }
  });
  ids.consultancyOffer = consultancyOffer.id;
  ids.request = (
    await prisma.consultancyRequest.create({
      data: { providerId: providerA, clientId: clientA, responseDeadlineAt: inOneDay() }
    })
  ).id;
  ids.quotedRequest = (
    await prisma.consultancyRequest.create({
      data: {
        providerId: providerA,
        clientId: clientA,
        responseDeadlineAt: inOneDay(),
        status: "RESPONDED",
        quotedOfferId: consultancyOffer.id
      }
    })
  ).id;
  const contractRequest = await prisma.consultancyRequest.create({
    data: { providerId: providerA, clientId: clientA, responseDeadlineAt: inOneDay(), status: "ACCEPTED" }
  });
  const contract = await prisma.consultancyContract.create({
    data: {
      requestId: contractRequest.id,
      providerId: providerA,
      clientId: clientA,
      offerId: consultancyOffer.id,
      paymentAmountCents: 20_000,
      providerAmountCents: 18_000,
      platformAmountCents: 2_000,
      billingCycle: "MONTHLY",
      kind: "ONLINE_CONSULTANCY",
      deliveryDeadlineAt: inOneDay(),
      immediateExecutionAcknowledgedAt: new Date(),
      status: "ACTIVE"
    }
  });
  ids.contract = contract.id;
  ids.trainingPlan = (
    await prisma.trainingPlan.create({ data: { providerId: providerA, contractId: contract.id, title: "Ficha do A" } })
  ).id;
  ids.consultancyMessage = (
    await prisma.consultancyMessage.create({ data: { contractId: contract.id, senderId: clientA, content: "Oi" } })
  ).id;
  ids.invite = (
    await prisma.externalStudentInvite.create({
      data: {
        providerId: providerA,
        tokenHash: `hash_${runId}`,
        studentName: "Aluno externo",
        channel: "WHATSAPP",
        expiresAt: inOneDay()
      }
    })
  ).id;

  // Painel do providerA
  ids.calendarEvent = (
    await prisma.providerCalendarEvent.create({
      data: {
        providerId: providerA,
        title: "Compromisso",
        startsAt: inOneDay(),
        endsAt: new Date(inOneDay().getTime() + 60 * 60 * 1000)
      }
    })
  ).id;
  await prisma.clientAnamnesis.create({ data: { clientId: clientA, status: "COMPLETED" } });
  ids.availability = (
    await prisma.availability.create({
      data: { providerId: providerA, weekday: 1, startTime: "09:00", endTime: "12:00" }
    })
  ).id;
  ids.manualBlock = (
    await prisma.providerManualBlock.create({
      data: {
        providerId: providerA,
        date: inOneDay().toISOString().slice(0, 10),
        startTime: "12:00",
        endTime: "13:00",
        label: "Almoço"
      }
    })
  ).id;
  ids.financialStudent = (
    await prisma.financialStudent.create({
      data: { providerId: providerA, name: "Aluno do A", monthlyValueCents: 30_000, type: "PRESENTIAL" }
    })
  ).id;
  ids.income = (
    await prisma.financialIncome.create({
      data: { providerId: providerA, description: "Mensalidade", amountCents: 30_000, paidAt: new Date() }
    })
  ).id;
  ids.expense = (
    await prisma.financialExpense.create({
      data: { providerId: providerA, description: "Academia", amountCents: 10_000, paidAt: new Date() }
    })
  ).id;

  // Comunidade: comentário do clientA
  const post = await prisma.feedPost.create({ data: { userId: clientA, type: "MANUAL_PHOTO", caption: "Treino" } });
  ids.post = post.id;
  ids.comment = (
    await prisma.feedPostComment.create({ data: { postId: post.id, userId: clientA, content: "Meu comentário" } })
  ).id;

  snapshotBefore = await ownerDataSnapshot();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const cases: Case[] = [
  // Agenda presencial (dono: clientA e providerA)
  { name: "validar presença com o código certo", as: "providerB", method: "post", url: () => `/api/bookings/${ids.booking}/attendance-code/verify`, body: { code: attendanceCode } },
  { name: "validar presença com o QR certo", as: "providerB", method: "post", url: () => `/api/bookings/${ids.booking}/attendance-code/verify-qr`, body: () => ({ qrToken: attendanceQrToken }) },
  { name: "denunciar falta (aluno)", as: "clientB", method: "post", url: () => `/api/bookings/${ids.booking}/report-no-show`, body: { reportReason: "Não veio" } },
  { name: "denunciar falta (profissional)", as: "providerB", method: "post", url: () => `/api/bookings/${ids.booking}/report-no-show`, body: { reportReason: "Não veio" } },
  { name: "contestar falta", as: "clientB", method: "post", url: () => `/api/bookings/${ids.booking}/contest-no-show`, body: { contestReason: "Eu fui" } },
  { name: "retirar denúncia de falta", as: "providerB", method: "post", url: () => `/api/bookings/${ids.booking}/withdraw-no-show` },
  { name: "contestar conclusão automática", as: "clientB", method: "post", url: () => `/api/bookings/${ids.booking}/contest-auto-capture`, body: { reason: "Não aconteceu" } },
  { name: "ver o outro participante da agenda", as: "clientB", method: "get", url: () => `/api/bookings/${ids.booking}/other-user` },
  { name: "ver foto do outro participante", as: "clientB", method: "get", url: () => `/api/bookings/${ids.booking}/other-user-photo` },
  { name: "ler chat da agenda", as: "clientB", method: "get", url: () => `/api/bookings/${ids.booking}/messages` },
  { name: "ler chat da agenda (profissional)", as: "providerB", method: "get", url: () => `/api/bookings/${ids.booking}/messages` },
  { name: "mandar mensagem no chat da agenda", as: "clientB", method: "post", url: () => `/api/bookings/${ids.booking}/messages`, body: { content: "Intruso" } },

  // Pagamentos (dono: clientA)
  { name: "ver pagamento da agenda", as: "clientB", method: "get", url: () => `/api/payments/booking/${ids.booking}` },
  { name: "ver pagamento da agenda (profissional)", as: "providerB", method: "get", url: () => `/api/payments/booking/${ids.booking}` },
  { name: "gerar PIX da agenda", as: "clientB", method: "post", url: () => `/api/payments/booking/${ids.booking}/pix/charge` },
  { name: "trocar forma de pagamento da agenda", as: "clientB", method: "patch", url: () => `/api/payments/booking/${ids.booking}/method`, body: { method: "PIX" } },
  { name: "renomear cartão", as: "clientB", method: "patch", url: () => `/api/payments/customer/cards/${ids.card}`, body: { nickname: "Meu agora" } },
  { name: "tornar cartão padrão", as: "clientB", method: "patch", url: () => `/api/payments/customer/cards/${ids.card}/default` },
  { name: "remover cartão", as: "clientB", method: "delete", url: () => `/api/payments/customer/cards/${ids.card}` },
  { name: "pagar dívida", as: "clientB", method: "post", url: () => `/api/debts/${ids.debt}/pay`, body: { method: "PIX" } },

  // Pacote presencial (dono: clientA e providerA)
  { name: "ver pacote presencial", as: "clientB", method: "get", url: () => `/api/presential-packages/${ids.package}` },
  { name: "ver pacote presencial (profissional)", as: "providerB", method: "get", url: () => `/api/presential-packages/${ids.package}` },
  { name: "cancelar pacote presencial", as: "clientB", method: "post", url: () => `/api/presential-packages/${ids.package}/cancel` },

  // Avaliações
  { name: "responder avaliação de outro profissional", as: "providerB", method: "patch", url: () => `/api/reviews/${ids.review}/response`, body: { response: "Resposta do intruso" } },

  // Consultoria online (dono: clientA e providerA)
  { name: "concluir ficha de treino", as: "clientB", method: "post", url: () => `/api/consultancy/my/training/plans/${ids.trainingPlan}/complete`, body: { notes: "Feito" } },
  { name: "decidir proposta de consultoria", as: "clientB", method: "post", url: () => `/api/consultancy/requests/${ids.quotedRequest}/decision`, body: { decision: "REFUSE" } },
  { name: "responder pedido de consultoria", as: "providerB", method: "post", url: () => `/api/consultancy/requests/${ids.request}/respond`, body: () => ({ providerResponseText: "Proposta do intruso", quotedOfferId: ids.consultancyOffer }) },
  { name: "contestar entrega da consultoria", as: "clientB", method: "post", url: () => `/api/consultancy/contracts/${ids.contract}/contest-delivery`, body: { reason: "Não recebi" } },
  { name: "entregar ficha num contrato alheio", as: "providerB", method: "post", url: () => `/api/consultancy/contracts/${ids.contract}/deliver`, body: { title: "Ficha intrusa", exercises: [exercise] } },
  { name: "editar oferta", as: "providerB", method: "patch", url: () => `/api/consultancy/provider/offers/${ids.consultancyOffer}`, body: { title: "Oferta sequestrada" } },
  { name: "apagar oferta", as: "providerB", method: "delete", url: () => `/api/consultancy/provider/offers/${ids.consultancyOffer}` },
  { name: "editar ficha", as: "providerB", method: "patch", url: () => `/api/consultancy/provider/plans/${ids.trainingPlan}`, body: { title: "Ficha sequestrada" } },
  { name: "apagar ficha", as: "providerB", method: "delete", url: () => `/api/consultancy/provider/plans/${ids.trainingPlan}` },
  { name: "cancelar convite de aluno externo", as: "providerB", method: "post", url: () => `/api/consultancy/external-students/invites/${ids.invite}/cancel` },
  { name: "confirmar check-in de aluno externo", as: "providerB", method: "post", url: () => `/api/consultancy/external-students/check-ins/${ids.contract}/confirm` },
  { name: "ver o outro participante da consultoria", as: "clientB", method: "get", url: () => `/api/consultancy/contracts/${ids.contract}/other-user` },
  { name: "ver o outro participante da consultoria (profissional)", as: "providerB", method: "get", url: () => `/api/consultancy/contracts/${ids.contract}/other-user` },
  { name: "denunciar mensagem da consultoria", as: "clientB", method: "post", url: () => `/api/consultancy/contracts/${ids.contract}/messages/${ids.consultancyMessage}/report`, body: { reason: "Spam" } },
  { name: "denunciar mensagem do chat da agenda", as: "providerB", method: "post", url: () => `/api/bookings/${ids.booking}/messages/${ids.bookingMessage}/report`, body: { reason: "Spam" } },

  // Painel do profissional (dono: providerA)
  { name: "editar compromisso da agenda", as: "providerB", method: "patch", url: () => `/api/providers/dashboard/calendar/manual/${ids.calendarEvent}`, body: { title: "Sequestrado" } },
  { name: "apagar compromisso da agenda", as: "providerB", method: "delete", url: () => `/api/providers/dashboard/calendar/manual/${ids.calendarEvent}` },
  { name: "ver ficha de aluno de outro profissional", as: "providerB", method: "get", url: () => `/api/providers/dashboard/students/${userIds.clientA}` },
  { name: "ver anamnese (saúde) de aluno de outro profissional", as: "providerB", method: "get", url: () => `/api/providers/dashboard/students/${userIds.clientA}/anamnesis` },
  { name: "gravar avaliação física em aluno de outro profissional", as: "providerB", method: "put", url: () => `/api/providers/dashboard/students/${userIds.clientA}/physical-assessment`, body: { weight: "80" } },
  { name: "apagar disponibilidade", as: "providerB", method: "delete", url: () => `/api/availability/${ids.availability}` },
  { name: "apagar bloqueio de agenda", as: "providerB", method: "delete", url: () => `/api/manual-blocks/${ids.manualBlock}` },
  { name: "editar aluno do financeiro", as: "providerB", method: "patch", url: () => `/api/financial/students/${ids.financialStudent}`, body: { name: "Sequestrado" } },
  { name: "apagar aluno do financeiro", as: "providerB", method: "delete", url: () => `/api/financial/students/${ids.financialStudent}` },
  { name: "editar receita", as: "providerB", method: "patch", url: () => `/api/financial/incomes/${ids.income}`, body: { amountCents: 1 } },
  { name: "apagar receita", as: "providerB", method: "delete", url: () => `/api/financial/incomes/${ids.income}` },
  { name: "editar despesa", as: "providerB", method: "patch", url: () => `/api/financial/expenses/${ids.expense}`, body: { amountCents: 1 } },
  { name: "apagar despesa", as: "providerB", method: "delete", url: () => `/api/financial/expenses/${ids.expense}` },

  // Comunidade e administração
  { name: "apagar comentário de outra pessoa", as: "clientB", method: "delete", url: () => `/api/community/feed/posts/${ids.post}/comments/${ids.comment}` },
  { name: "reativar categoria sem ser admin", as: "providerB", method: "patch", url: () => `/api/categories/${ids.inactiveCategory}/reactivate` }
];

// Leituras que o dono tem que conseguir fazer (controle positivo).
const ownerReads: Case[] = [
  { name: "chat da agenda", as: "clientA", method: "get", url: () => `/api/bookings/${ids.booking}/messages` },
  { name: "outro participante da agenda", as: "clientA", method: "get", url: () => `/api/bookings/${ids.booking}/other-user` },
  { name: "pagamento da agenda", as: "clientA", method: "get", url: () => `/api/payments/booking/${ids.booking}` },
  { name: "pacote presencial", as: "clientA", method: "get", url: () => `/api/presential-packages/${ids.package}` },
  { name: "outro participante da consultoria", as: "clientA", method: "get", url: () => `/api/consultancy/contracts/${ids.contract}/other-user` },
  { name: "ficha do aluno", as: "providerA", method: "get", url: () => `/api/providers/dashboard/students/${userIds.clientA}` },
  { name: "anamnese do aluno", as: "providerA", method: "get", url: () => `/api/providers/dashboard/students/${userIds.clientA}/anamnesis` }
];

// Notificações: a rota só mexe em notificação da própria pessoa (o filtro
// por dono está na própria busca). Com o id de outra pessoa ela não faz nada
// e responde 204, sem dizer se o id existe. Também é seguro; aqui a prova é
// a notificação do dono continuar intacta.
const silentNoOps: Case[] = [
  { name: "marcar notificação como lida", as: "clientB", method: "patch", url: () => `/api/notifications/inbox/${ids.notification}/read` },
  { name: "apagar notificação", as: "clientB", method: "delete", url: () => `/api/notifications/inbox/${ids.notification}` }
];

describe("acesso entre usuários: o intruso é barrado", () => {
  it.each(cases)("$as não consegue: $name", async (c) => {
    const res = await send(c, c.url());
    expect([403, 404], `${c.method.toUpperCase()} ${c.url()} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(
      res.status
    );
  });

  it.each(silentNoOps)("$as não consegue (a rota ignora em silêncio): $name", async (c) => {
    const res = await send(c, c.url());
    expect(res.status).toBe(204);
    const notification = await prisma.userNotification.findUniqueOrThrow({ where: { id: ids.notification } });
    expect(notification.readAt).toBeNull();
    expect(notification.dismissedAt).toBeNull();
  });

  it("nenhum dado do dono mudou depois de todas as tentativas", async () => {
    expect(await ownerDataSnapshot()).toEqual(snapshotBefore);
  });
});

describe("acesso entre usuários: o dono continua lendo o próprio dado", () => {
  it.each(ownerReads)("$as lê: $name", async (c) => {
    const res = await send(c, c.url());
    expect(res.status, `${c.url()} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(200);
  });
});
