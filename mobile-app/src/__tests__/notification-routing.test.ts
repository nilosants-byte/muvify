import { resolveNotificationRoute } from "../navigation/notification-routing";

// Segunda camada (Frente 1, Lote 2): vários tipos de notificação já eram
// emitidos pelo backend com dados suficientes pra abrir a tela certa, mas
// caíam no destino genérico porque routeNotification (root-stack.tsx) nunca
// tinha sido atualizado pra eles. Esse arquivo testa a lógica pura de
// roteamento (extraída pra notification-routing.ts) pra esses casos não
// regredirem de novo.

const BOOKING_ID = "11111111-1111-1111-1111-111111111111";

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

describe("resolveNotificationRoute — mensagem de chat continua priorizada sobre o tipo genérico de agendamento", () => {
  it("CHAT_MESSAGE do profissional abre a conversa, não o detalhe do agendamento", () => {
    expect(resolveNotificationRoute({ type: "CHAT_MESSAGE", bookingId: BOOKING_ID }, "PROVIDER")).toEqual({
      screen: "ProfessionalChatList",
      params: { openBookingId: BOOKING_ID }
    });
  });
});
