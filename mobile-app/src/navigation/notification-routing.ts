// Segunda camada (Frente 1, Lote 2): lógica de "pra qual tela um aviso deve
// levar" extraída do root-stack.tsx pra um módulo puro, sem depender de
// navegação/React - existia um histórico recorrente (Frente 9, Lotes 4/17/18
// do épico anterior, e agora esta frente) de tipos de notificação novos
// ficarem esquecidos aqui, caindo silenciosamente no destino genérico. Um
// módulo isolado e testável reduz a chance de isso se repetir de novo.

export type NotificationRouteTarget = { screen: string; params?: Record<string, unknown> };

const BOOKING_TYPES_PRO = new Set([
  "BOOKING_CREATED", "BOOKING_CONFIRMED", "BOOKING_CANCELLED", "BOOKING_COMPLETED",
  "BOOKING_EXPIRED", "BOOKING_ATTENDANCE_CODE_AVAILABLE", "BOOKING_ATTENDANCE_CODE_VALIDATED",
  "BOOKING_CONFIRMATION_PENDING", "CHAT_MESSAGE", "SESSION_REMINDER",
  // Segunda camada, Frente 1, Lote 2 (fechamento): estes tipos já eram
  // emitidos com bookingId de verdade pro profissional, mas caíam no
  // fallback genérico - justo os casos de maior tensão (falta, contestação,
  // cobrança automática contestada, prazo de confirmação vencendo).
  "BOOKING_CONFIRMATION_DUE_SOON", "BOOKING_CONFIRMATION_DEADLINE_EXPIRED",
  "BOOKING_CONFIRMATION_DEADLOCK", "BOOKING_NO_SHOW", "BOOKING_NO_SHOW_CONTESTED",
  "BOOKING_NO_SHOW_RESOLVED", "BOOKING_ATTENDANCE_NOT_VALIDATED", "BOOKING_AUTO_CAPTURE_CONTESTED",
]);
const BOOKING_TYPES_CLIENT = new Set([
  "BOOKING_CONFIRMED", "BOOKING_CANCELLED", "BOOKING_COMPLETED",
  "BOOKING_EXPIRED", "BOOKING_ATTENDANCE_CODE_AVAILABLE",
  "CHAT_MESSAGE", "SESSION_REMINDER",
  // Segunda camada, Frente 1, Lote 2 (fechamento): mesmo motivo do lado
  // profissional acima - todos emitidos com bookingId, caíam no genérico.
  "BOOKING_NO_SHOW", "BOOKING_NO_SHOW_RESOLVED", "BOOKING_CANCELLED_PROVIDER_UNAVAILABLE",
  "REVIEW_REMINDER", "PAYMENT_AUTHORIZED", "PAYMENT_CAPTURED", "PAYMENT_REFUNDED",
  "PAYMENT_CANCELED", "PAYMENT_CAPTURE_FAILED", "PAYMENT_REFUND_FAILED",
  "PAYMENT_IN_MEDIATION", "PAYMENT_DISPUTED",
  // Frente 6 (segunda camada), Lote 6: mesmo tipo de lacuna já corrigida do
  // lado profissional na Frente 1/Lote 2 — estes 5 tipos são emitidos pro
  // cliente também (booking.service.ts envia pra clientId e provider.userId
  // juntos em todos os casos), mas só o conjunto PRO tinha sido atualizado.
  "BOOKING_NO_SHOW_CONTESTED", "BOOKING_AUTO_CAPTURE_CONTESTED",
  "BOOKING_ATTENDANCE_NOT_VALIDATED", "BOOKING_CONFIRMATION_DEADLINE_EXPIRED",
  "BOOKING_CONFIRMATION_DEADLOCK",
]);

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 9: os tipos de
// notificação de consultoria/pacote presencial (renovação de ficha, Pix
// expirado, contestação de entrega etc.) continuam sendo criados aos
// montes - checar por prefixo em vez de manter uma lista literal evita que
// um tipo novo fique esquecido de novo, tanto aqui quanto na invalidação de
// cache (root-stack.tsx).
export function isConsultancyNotificationType(type: string) {
  return type.startsWith("CONSULTANCY_") || type.startsWith("COMBO_CONSULTANCY_");
}
export function isPresentialPackageNotificationType(type: string) {
  return type.startsWith("PRESENTIAL_PACKAGE_") || type.startsWith("COMBO_CONSULTANCY_");
}
// Épico de Frentes, Frente 7, Lote 10: notificação de pagamento (captura,
// reembolso, falha de captura, disputa etc.) recebida em primeiro plano
// nunca invalidava o dashboard financeiro - o profissional olhando a tela
// no momento exato de uma captura/reembolso não via o saldo mudar sozinho.
export function isPaymentNotificationType(type: string) {
  return type.startsWith("PAYMENT_");
}

export function isBookingNotificationType(type: string): boolean {
  return BOOKING_TYPES_PRO.has(type) || BOOKING_TYPES_CLIENT.has(type);
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | undefined {
  return typeof value === "string" && uuidRegex.test(value) ? value : undefined;
}

// Decide pra qual tela um aviso (push ou item da central de notificações)
// deve levar, dado o papel (role) de quem está vendo. Retorna null quando
// nenhum destino específico se aplica - quem chama decide o fallback (hoje,
// sempre a central de notificações em si).
export function resolveNotificationRoute(
  data: Record<string, unknown>,
  role: string | null | undefined
): NotificationRouteTarget | null {
  const type = typeof data.type === "string" ? data.type : "";
  const bookingId = asUuid(data.bookingId);
  const packageId = asUuid(data.packageId);
  const clientId = asUuid(data.clientId);
  const clientName = typeof data.clientName === "string" && data.clientName ? data.clientName : "Aluno";
  // Épico de Frentes, Frente 9, Lote 8: mensagem de chat de consultoria
  // (Lote 7) chega com contractId em vez de bookingId no payload.
  const contractId = asUuid(data.contractId);

  if (role === "PROVIDER") {
    // Mensagem de chat sempre foi tratada como um tipo de agendamento
    // qualquer (BOOKING_TYPES_PRO inclui CHAT_MESSAGE) e levava pro
    // detalhe do agendamento em vez do chat - checa isso primeiro.
    if (type === "CHAT_MESSAGE") {
      const params = bookingId ? { openBookingId: bookingId } : contractId ? { openContractId: contractId } : undefined;
      return { screen: "ProfessionalChatList", params };
    }
    if (bookingId && BOOKING_TYPES_PRO.has(type)) {
      return { screen: "BookingDetailProfessional", params: { bookingId } };
    }
    // Épico de Frentes, Frente 9, Lote 5: não existe tela de comunidade
    // no app do profissional - o detalhe do aluno é o destino mais
    // próximo já disponível pra essa notificação.
    if (type === "STUDENT_POST_MENTION" && clientId) {
      return { screen: "ProfessionalStudentAnamnesis", params: { clientId, clientName } };
    }
    // Frente 9 (segunda camada), Lote 12: sempre caía na tab default
    // "dashboard" - ProfessionalConsultancyCenterScreen já aceita
    // initialTab (usado só quando o usuário toca no menu), nunca vinha do
    // roteamento de notificação.
    if (isConsultancyNotificationType(type)) {
      return { screen: "ProfessionalConsultancyCenter", params: { initialTab: "requests" } };
    }
    // Não há tela de detalhe de pacote presencial pro profissional (só
    // clientId, sem packageId, chega no payload) - a lista de alunos é o
    // destino mais próximo disponível hoje, melhor que cair no genérico.
    if (isPresentialPackageNotificationType(type)) {
      return { screen: "ProfessionalStudents" };
    }
    // Épico de Frentes, Frente 9, Lote 17: PAYMENT_TYPES_PRO era uma
    // lista fixa que não incluía vários tipos já emitidos pelo backend
    // (captura, disputa aberta, falha de captura, em mediação, falha de
    // reembolso) - caíam no fallback genérico. isPaymentNotificationType
    // (por prefixo) já é usado pra invalidação de cache; agora também
    // pro roteamento, uma única fonte de verdade.
    if (isPaymentNotificationType(type)) {
      return { screen: "PayoutStatus" };
    }
    // Segunda camada, Frente 1, Lote 2 (fechamento): esse aviso significa
    // que o profissional PAROU de receber vendas até reconectar a conta -
    // caía no fallback genérico, sumindo no meio da central de avisos em
    // vez de levar direto pra tela que resolve o problema.
    if (type === "MP_TOKEN_INVALIDATED") {
      return { screen: "ConnectPayoutAccount" };
    }
    if (type === "DEBT_RECORD_PAID") {
      return { screen: "ProviderDebts" };
    }
    // Épico de Frentes, Frente 9, Lote 18: sem tratamento, caía no
    // fallback genérico - o histórico financeiro é o destino mais
    // próximo já disponível.
    // Frente 3 (segunda camada), Lote 7: quando a resolução gerou uma
    // dívida pro profissional (reembolso ao cliente descontado do próximo
    // repasse), a tela Financeiro genérica não menciona essa dívida em
    // lugar nenhum — leva direto pra Pendências, onde ela de fato aparece.
    if (type === "DISPUTE_CASE_RESOLVED") {
      return { screen: data.providerDebtCreated === true ? "ProviderDebts" : "PayoutStatus" };
    }
    if (type === "SUPPORT_REPLY") {
      return { screen: "Support" };
    }
    return null;
  }

  // Frente 7 (segunda camada), Lote 13: role "ADMIN" nunca era tratado
  // explicitamente aqui — caía nos dois "if" de cima (nenhum bate) até o
  // "return null" do fim da função, funcionando por acidente em vez de por
  // decisão. Explícito agora: o app não tem central de avisos nem rota de
  // notificação pro admin hoje (nenhum push é enviado pra esse role).
  if (role === "ADMIN") {
    return null;
  }

  if (role === "CLIENT") {
    if (type === "CHAT_MESSAGE") {
      const params = bookingId ? { openBookingId: bookingId } : contractId ? { openContractId: contractId } : undefined;
      return { screen: "ClientChatList", params };
    }
    if (bookingId && BOOKING_TYPES_CLIENT.has(type)) {
      return { screen: "ClientBookingDetail", params: { bookingId } };
    }
    if (isPresentialPackageNotificationType(type) && packageId) {
      return { screen: "PresentialPackageDetail", params: { packageId } };
    }
    // Frente 9 (segunda camada), Lote 12: sempre caía na tab default
    // "Ativos" - a proposta/pagamento/entrega que gerou o aviso normalmente
    // está em "Pendentes".
    if (isConsultancyNotificationType(type)) {
      return { screen: "MyTraining", params: { initialTab: "pending" } };
    }
    if (type === "PAYMENT_AUTH_FAILED") {
      return { screen: "ClientPaymentMethod" };
    }
    // Épico de Frentes, Frente 9, Lote 4: tipos de comunidade não tinham
    // nenhum tratamento aqui e caíam no fallback genérico (central de
    // avisos) mesmo com um destino óbvio disponível.
    if (type === "NEW_FOLLOWER" || type === "ACHIEVEMENT_UNLOCKED" || type === "STREAK_MILESTONE") {
      return { screen: "ClientTabs", params: { screen: "Community" } };
    }
    // Épico de Frentes, Frente 9, Lote 18: sem tratamento, caía no
    // fallback genérico.
    if (type === "DISPUTE_CASE_RESOLVED") {
      return { screen: "MyDisputes" };
    }
    if (type === "SUPPORT_REPLY") {
      return { screen: "Support" };
    }
    return null;
  }

  return null;
}
