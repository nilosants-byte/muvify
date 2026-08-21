import { resolveNotificationRoute } from "../navigation/notification-routing";

// Segunda camada (Frente 1, Lote 2): vários tipos de notificação já eram
// emitidos pelo backend com dados suficientes pra abrir a tela certa, mas
// caíam no destino genérico porque routeNotification (root-stack.tsx) nunca
// tinha sido atualizado pra eles. Esse arquivo testa a lógica pura de
// roteamento (extraída pra notification-routing.ts) pra esses casos não
// regredirem de novo.

const BOOKING_ID = "11111111-1111-1111-1111-111111111111";
const CONTRACT_ID = "22222222-2222-2222-2222-222222222222";

describe("resolveNotificationRoute — profissional", () => {
  it("MP_TOKEN_INVALIDATED leva pra reconectar Mercado Pago", () => {
    expect(resolveNotificationRoute({ type: "MP_TOKEN_INVALIDATED" }, "PROVIDER")).toEqual({
      screen: "ConnectPayoutAccount"
    });
  });

  it("DEBT_RECORD_PAID leva pra tela de pendências", () => {
    expect(resolveNotificationRoute({ type: "DEBT_RECORD_PAID" }, "PROVIDER")).toEqual({
      screen: "ProviderDebts"
    });
  });

  // Frente 3 (segunda camada), Lote 7: quando a resolução da disputa cria
  // uma dívida pro profissional (reembolso descontado do próximo repasse),
  // a notificação precisa levar pra tela onde essa dívida de fato aparece —
  // não pro Financeiro genérico, que não menciona a dívida em lugar nenhum.
  it("DISPUTE_CASE_RESOLVED com providerDebtCreated leva pra Pendências", () => {
    expect(resolveNotificationRoute({ type: "DISPUTE_CASE_RESOLVED", providerDebtCreated: true }, "PROVIDER")).toEqual({
      screen: "ProviderDebts"
    });
  });

  it("DISPUTE_CASE_RESOLVED sem dívida (retry de captura, reembolso negado) leva pro Financeiro", () => {
    expect(resolveNotificationRoute({ type: "DISPUTE_CASE_RESOLVED", providerDebtCreated: false }, "PROVIDER")).toEqual({
      screen: "PayoutStatus"
    });
    expect(resolveNotificationRoute({ type: "DISPUTE_CASE_RESOLVED" }, "PROVIDER")).toEqual({
      screen: "PayoutStatus"
    });
  });

  it.each([
    "BOOKING_CONFIRMATION_DUE_SOON",
    "BOOKING_CONFIRMATION_DEADLINE_EXPIRED",
    "BOOKING_CONFIRMATION_DEADLOCK",
    "BOOKING_NO_SHOW",
    "BOOKING_NO_SHOW_CONTESTED",
    "BOOKING_NO_SHOW_RESOLVED",
    "BOOKING_ATTENDANCE_NOT_VALIDATED",
    "BOOKING_AUTO_CAPTURE_CONTESTED"
  ])("%s com bookingId abre o detalhe do agendamento", (type) => {
    expect(resolveNotificationRoute({ type, bookingId: BOOKING_ID }, "PROVIDER")).toEqual({
      screen: "BookingDetailProfessional",
      params: { bookingId: BOOKING_ID }
    });
  });

  it("tipo desconhecido não define destino (fica a cargo do chamador cair no genérico)", () => {
    expect(resolveNotificationRoute({ type: "ALGO_NUNCA_VISTO" }, "PROVIDER")).toBeNull();
  });
});

describe("resolveNotificationRoute — cliente", () => {
  it.each([
    "BOOKING_NO_SHOW",
    "BOOKING_NO_SHOW_RESOLVED",
    "BOOKING_CANCELLED_PROVIDER_UNAVAILABLE",
    "REVIEW_REMINDER"
  ])("%s com bookingId abre o detalhe do agendamento", (type) => {
    expect(resolveNotificationRoute({ type, bookingId: BOOKING_ID }, "CLIENT")).toEqual({
      screen: "ClientBookingDetail",
      params: { bookingId: BOOKING_ID }
    });
  });

  // Frente 6 (segunda camada), Lote 6: estes 5 tipos já eram emitidos pro
  // cliente com bookingId de verdade (booking.service.ts envia pra
  // clientId e provider.userId juntos), mas caíam no destino genérico
  // porque só o conjunto PROVIDER tinha sido corrigido (Frente 1, Lote 2).
  it.each([
    "BOOKING_NO_SHOW_CONTESTED",
    "BOOKING_AUTO_CAPTURE_CONTESTED",
    "BOOKING_ATTENDANCE_NOT_VALIDATED",
    "BOOKING_CONFIRMATION_DEADLINE_EXPIRED",
    "BOOKING_CONFIRMATION_DEADLOCK"
  ])("%s com bookingId abre o detalhe do agendamento", (type) => {
    expect(resolveNotificationRoute({ type, bookingId: BOOKING_ID }, "CLIENT")).toEqual({
      screen: "ClientBookingDetail",
      params: { bookingId: BOOKING_ID }
    });
  });

  it.each([
    "PAYMENT_AUTHORIZED",
    "PAYMENT_CAPTURED",
    "PAYMENT_REFUNDED",
    "PAYMENT_CANCELED",
    "PAYMENT_CAPTURE_FAILED",
    "PAYMENT_REFUND_FAILED",
    "PAYMENT_IN_MEDIATION",
    "PAYMENT_DISPUTED"
  ])("%s com bookingId abre o detalhe do agendamento (mostra o status do pagamento)", (type) => {
    expect(resolveNotificationRoute({ type, bookingId: BOOKING_ID }, "CLIENT")).toEqual({
      screen: "ClientBookingDetail",
      params: { bookingId: BOOKING_ID }
    });
  });

  it("PAYMENT_AUTH_FAILED continua indo direto pro método de pagamento, não pro detalhe do agendamento", () => {
    expect(resolveNotificationRoute({ type: "PAYMENT_AUTH_FAILED", bookingId: BOOKING_ID }, "CLIENT")).toEqual({
      screen: "ClientPaymentMethod"
    });
  });

  it("tipo desconhecido não define destino", () => {
    expect(resolveNotificationRoute({ type: "ALGO_NUNCA_VISTO" }, "CLIENT")).toBeNull();
  });
});

// Frente 7 (segunda camada), Lote 13: role "ADMIN" nunca era tratado
// explicitamente — funcionava só por acidente (caindo no "return null" do
// fim da função). Explícito agora, e routeNotification (root-stack.tsx)
// para de tentar cair no fallback "Notifications" pra esse role, já que
// AdminStack não tem essa rota registrada.
describe("resolveNotificationRoute — admin", () => {
  it("nenhum destino específico é definido pro role admin (sem central de avisos hoje)", () => {
    expect(resolveNotificationRoute({ type: "MP_TOKEN_INVALIDATED" }, "ADMIN")).toBeNull();
    expect(resolveNotificationRoute({ type: "CHAT_MESSAGE", bookingId: BOOKING_ID }, "ADMIN")).toBeNull();
    expect(resolveNotificationRoute({ type: "ALGO_NUNCA_VISTO" }, "ADMIN")).toBeNull();
  });
});

describe("resolveNotificationRoute — mensagem de chat continua priorizada sobre o tipo genérico de agendamento", () => {
  it("CHAT_MESSAGE do profissional abre a conversa, não o detalhe do agendamento", () => {
    expect(resolveNotificationRoute({ type: "CHAT_MESSAGE", bookingId: BOOKING_ID }, "PROVIDER")).toEqual({
      screen: "ProfessionalChatList",
      params: { openBookingId: BOOKING_ID }
    });
  });
});

// Frente 9 (segunda camada), Lote 12: notificação de consultoria sempre
// caía na tab default de cada tela (dashboard/ativos) - agora abre direto
// na aba de pedidos/pendentes, onde a proposta/pagamento/entrega que gerou
// o aviso normalmente está.
describe("resolveNotificationRoute — consultoria abre a aba certa, não a tab default", () => {
  it("notificação de consultoria pro profissional abre a aba de pedidos", () => {
    expect(resolveNotificationRoute({ type: "CONSULTANCY_CONTRACT_ACCEPTED" }, "PROVIDER")).toEqual({
      screen: "ProfessionalConsultancyCenter",
      params: { initialTab: "requests" }
    });
  });

  it("notificação de consultoria pro cliente abre a aba Pendentes de Meu Treino", () => {
    expect(resolveNotificationRoute({ type: "CONSULTANCY_CONTRACT_ACCEPTED" }, "CLIENT")).toEqual({
      screen: "MyTraining",
      params: { initialTab: "pending" }
    });
  });
});

// Segunda camada: aviso de aluno de consultoria inativo (3+ dias sem
// treinar) precisa abrir o chat com aquele aluno direto, não a central de
// solicitações (isConsultancyNotificationType casaria por prefixo se este
// "if" não viesse antes).
describe("resolveNotificationRoute — aluno de consultoria inativo abre o chat, não a central", () => {
  it("CONSULTANCY_CLIENT_INACTIVE com contractId abre o chat do profissional com esse aluno", () => {
    expect(resolveNotificationRoute({ type: "CONSULTANCY_CLIENT_INACTIVE", contractId: CONTRACT_ID }, "PROVIDER")).toEqual({
      screen: "ProfessionalChatList",
      params: { openContractId: CONTRACT_ID }
    });
  });

  it("CONSULTANCY_CLIENT_INACTIVE sem contractId cai no roteamento genérico de consultoria", () => {
    expect(resolveNotificationRoute({ type: "CONSULTANCY_CLIENT_INACTIVE" }, "PROVIDER")).toEqual({
      screen: "ProfessionalConsultancyCenter",
      params: { initialTab: "requests" }
    });
  });
});

// Segunda camada: lembrete diário de meta de treino e nudge de configuração
// de meta (goal-reminder.job.ts) não tinham nenhum tratamento aqui — sem
// tela de detalhe própria, a aba Comunidade (onde a sequência/streak
// aparece) é o destino mais próximo já usado por NEW_FOLLOWER/
// ACHIEVEMENT_UNLOCKED/STREAK_MILESTONE.
describe("resolveNotificationRoute — lembretes de meta de treino abrem a Comunidade", () => {
  it.each(["DAILY_TRAINING_REMINDER", "WEEKLY_GOAL_SETUP_NUDGE"])("%s pro cliente abre a aba Comunidade", (type) => {
    expect(resolveNotificationRoute({ type }, "CLIENT")).toEqual({
      screen: "ClientTabs",
      params: { screen: "Community" }
    });
  });
});
