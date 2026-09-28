import ExcelJS from "exceljs";
import type { UserService } from "./user.service";

// Versão legível da exportação de dados pessoais (LGPD, art. 18/19): o JSON
// continua sendo o formato completo e interoperável (portabilidade), mas é
// ilegível pra quem não é técnico. Esta planilha organiza as seções que o
// titular reconhece (agendamentos, pagamentos, mensagens etc.) em abas, com
// títulos em português, datas no fuso de Brasília, valores em R$ e status
// traduzidos. Seções sem tradução prática (fotos, dispositivos, sessões...)
// aparecem na aba "Resumo" apontando pro arquivo técnico.

type ExportPayload = Awaited<ReturnType<UserService["exportMyData"]>>;

const TIMEZONE = "America/Sao_Paulo";
const MONEY_FORMAT = '"R$" #,##0.00';
const TECHNICAL_ONLY = "Somente no arquivo técnico (JSON)";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtDateTime(value: unknown): string {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date).replace(",", "") : "";
}

function fmtDate(value: unknown): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : "";
}

function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value / 100 : null;
}

function yesNo(value: unknown): string {
  return value ? "Sim" : "Não";
}

function translate(map: Record<string, string>, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const key = String(value);
  return map[key] ?? key;
}

const ROLE: Record<string, string> = { CLIENT: "Aluno", PROVIDER: "Profissional", ADMIN: "Administrador" };
const BOOKING_STATUS: Record<string, string> = {
  PENDING: "Aguardando confirmação",
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  COMPLETED: "Concluído"
};
const PAYMENT_STATUS: Record<string, string> = {
  PENDING_AUTH: "Aguardando pagamento",
  AUTHORIZING: "Autorizando",
  AUTHORIZED: "Reservado no cartão",
  CAPTURED: "Pago",
  CANCELED: "Cancelado",
  FAILED: "Falhou",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Reembolsado em parte",
  PENDING: "Aguardando pagamento"
};
const PAYMENT_METHOD: Record<string, string> = {
  CARD: "Cartão",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  PIX: "Pix"
};
const REQUEST_STATUS: Record<string, string> = {
  OPEN: "Aguardando resposta",
  RESPONDED: "Respondido",
  ACCEPTED: "Aceito",
  REFUSED: "Recusado",
  EXPIRED: "Expirado",
  EXPIRED_REFUNDED: "Expirado (reembolsado)",
  ARCHIVED: "Arquivado"
};
const CONTRACT_STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Aguardando pagamento",
  ACTIVE: "Ativa",
  DELIVERED: "Treino entregue",
  CANCELLED: "Cancelada",
  REFUNDED_EXPIRED: "Expirada (reembolsada)",
  ARCHIVED: "Arquivada"
};
const CREF_STATUS: Record<string, string> = {
  PENDING: "Pendente",
  IN_REVIEW: "Em análise",
  APPROVED: "Aprovado",
  REJECTED: "Reprovado"
};
const SUPPORT_STATUS: Record<string, string> = { OPEN: "Em análise", ANSWERED: "Respondido" };
const DEBT_STATUS: Record<string, string> = {
  PENDING: "Pendente",
  NOTIFIED: "Pendente (avisado)",
  PAID: "Paga",
  WRITTEN_OFF: "Perdoada"
};
const OFFER_KIND: Record<string, string> = {
  PRESENTIAL: "Presencial",
  ONLINE_CONSULTANCY: "Consultoria online",
  ONLINE_CONSULTANCY_SPECIALIZED: "Consultoria personalizada",
  COMBO: "Combo (presencial + consultoria)"
};
const BILLING_CYCLE: Record<string, string> = {
  DAILY: "Diário",
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual"
};
const SERVICE_MODE: Record<string, string> = {
  PRESENTIAL_ONLY: "Só presencial",
  HOME_VISIT_ONLY: "Só atendimento em domicílio",
  BOTH: "Presencial e em domicílio"
};
const STUDENT_TYPE: Record<string, string> = {
  PRESENTIAL: "Presencial",
  ONLINE: "Online",
  APP: "Pelo app",
  BOTH: "Presencial e online"
};
const EXPENSE_CATEGORY: Record<string, string> = {
  GYM: "Academia",
  TRANSPORT: "Transporte",
  EQUIPMENT: "Equipamentos",
  MARKETING: "Divulgação",
  FORMATION: "Formação",
  SOFTWARE: "Software",
  PROFESSIONAL_SERVICES: "Serviços profissionais",
  RENT: "Aluguel",
  UNIFORM: "Uniforme",
  NUTRITION: "Nutrição",
  OTHER: "Outros"
};
const INCOME_SOURCE: Record<string, string> = { MANUAL: "Lançamento manual", APP: "Pelo app" };
const PACKAGE_STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Aguardando pagamento",
  ACTIVE: "Ativo",
  PAST_DUE: "Pagamento em atraso",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado"
};
const PACKAGE_MODE: Record<string, string> = {
  FIXED_RECURRING: "Horário fixo",
  FLEXIBLE_CREDITS: "Sessões avulsas"
};
const DISPUTE_TYPE: Record<string, string> = {
  NO_SHOW_CONTESTED: "Falta contestada",
  CHARGEBACK: "Contestação da cobrança no cartão",
  REFUND_FAILED: "Reembolso que falhou",
  DELIVERY_CONTESTED: "Entrega contestada",
  AUTO_CAPTURE_CONTESTED: "Cobrança automática contestada",
  CAPTURE_FAILED: "Falha na cobrança",
  CONFIRMATION_DEADLOCK: "Confirmação travada"
};
const DISPUTE_STATUS: Record<string, string> = { OPEN: "Em análise", RESOLVED: "Resolvida" };
const SUBSCRIPTION_STATUS: Record<string, string> = {
  TRIALING: "Período de teste",
  PENDING_PAYMENT: "Aguardando pagamento",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento em atraso",
  CANCELED: "Cancelada"
};
const DISPUTE_RESOLUTION: Record<string, string> = {
  REFUNDED: "Reembolsado",
  DENIED: "Reembolso negado",
  CAPTURED: "Pagamento mantido"
};
const WEEKDAY = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const FUNDING: Record<string, string> = { CREDIT: "Crédito", DEBIT: "Débito", UNKNOWN: "Não informado" };

type ColumnKind = "text" | "money" | "number";

interface Column<T> {
  header: string;
  value: (row: T) => unknown;
  width?: number;
  kind?: ColumnKind;
}

interface SheetRecord {
  name: string;
  count: number;
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function flattenAnswers(value: unknown, prefix = ""): Array<{ label: string; answer: string }> {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) {
    const allPrimitive = value.every((item) => item === null || typeof item !== "object");
    if (allPrimitive) return value.length ? [{ label: prefix, answer: value.map(String).join(", ") }] : [];
    return value.flatMap((item, index) => flattenAnswers(item, `${prefix} ${index + 1}`.trim()));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
      flattenAnswers(inner, prefix ? `${prefix} — ${humanizeKey(key)}` : humanizeKey(key))
    );
  }
  if (typeof value === "boolean") return [{ label: prefix, answer: yesNo(value) }];
  return [{ label: prefix, answer: String(value) }];
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F9D4D" } };
  });
  row.height = 22;
}

export async function buildDataExportWorkbook(data: ExportPayload): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muvify";
  workbook.created = new Date();

  const guide = workbook.addWorksheet("Leia-me");
  const summary = workbook.addWorksheet("Resumo");
  const records: SheetRecord[] = [];
  const sheetOf = new Map<string, string>();

  function addTable<T>(
    sheetName: string,
    rows: readonly T[] | null | undefined,
    columns: Array<Column<T>>,
    summaryKey?: string
  ): boolean {
    if (summaryKey) sheetOf.set(summaryKey, rows && rows.length > 0 ? sheetName : "");
    if (!rows || rows.length === 0) return false;
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns.map((column) => ({ header: column.header, width: column.width ?? 22 }));
    styleHeader(sheet.getRow(1));
    for (const row of rows) {
      const added = sheet.addRow(
        columns.map((column) => {
          const value = column.value(row);
          return value === undefined || value === null ? "" : (value as ExcelJS.CellValue);
        })
      );
      columns.forEach((column, index) => {
        const cell = added.getCell(index + 1);
        if (column.kind === "money") cell.numFmt = MONEY_FORMAT;
        cell.alignment = { vertical: "top", wrapText: true };
      });
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    records.push({ name: sheetName, count: rows.length });
    return true;
  }

  // ─── Meus dados (campo / valor) ─────────────────────────────────────────
  const profileRows: Array<[string, unknown]> = [
    ["Nome", data.profile.name],
    ["E-mail", data.profile.email],
    ["Telefone", data.profile.phone],
    ["Tipo de conta", translate(ROLE, data.profile.role)],
    ["Conta criada em", fmtDateTime(data.profile.createdAt)],
    ["Última atualização do cadastro", fmtDateTime(data.profile.updatedAt)],
    ["Termos de uso aceitos em", fmtDateTime(data.profile.termsAcceptedAt)],
    ["Política de privacidade aceita em", fmtDateTime(data.profile.privacyPolicyAcceptedAt)],
    ["Versão dos termos aceita", data.profile.termsVersion],
    ["Apelido", data.profile.apelido],
    ["CPF", data.profile.document],
    ["E-mail verificado em", fmtDateTime(data.profile.emailVerifiedAt)],
    ["E-mail de recuperação", data.profile.recoveryEmail],
    ["Autenticação em duas etapas", yesNo(data.profile.twoFactorEnabled)],
    ["Faltas registradas (no-show)", data.profile.noShowStrikes],
    ["Conta suspensa em", fmtDateTime(data.profile.suspendedAt)],
    ["Motivo da suspensão", data.profile.suspensionReason]
  ];
  const provider = data.providerData;
  if (provider) {
    const p = provider.profile;
    profileRows.push(
      ["", ""],
      ["PERFIL PROFISSIONAL", ""],
      ["Nome de exibição", p.displayName],
      ["Biografia", p.bio],
      ["Anos de experiência", p.experienceYears],
      ["Valor base da sessão", cents(p.priceCents)],
      ["Modalidade de atendimento", translate(SERVICE_MODE, p.serviceMode)],
      ["Número do CREF", p.crefNumber],
      ["Situação do CREF", translate(CREF_STATUS, p.crefValidationStatus)],
      ["Especialidades", Array.isArray(p.specialties) ? p.specialties.map(String).join(", ") : p.specialties ? String(p.specialties) : ""],
      ["Categorias", (p.categories ?? []).join(", ")],
      ["Nota média", p.averageRating],
      ["Total de avaliações", p.totalReviews],
      ["Antecedência mínima para agendar", p.minBookingNoticeHours != null ? `${p.minBookingNoticeHours}h` : ""],
      ["Duração padrão da sessão", p.sessionDurationMinutes != null ? `${p.sessionDurationMinutes} min` : ""],
      ["Consultoria online habilitada", yesNo(p.onlineConsultancyEnabled)],
      ["Conta conectada ao Mercado Pago", yesNo(p.mpAccountId)],
      ["CREF enviado em", fmtDateTime(p.crefHistory?.submittedAt)],
      ["CREF analisado em", fmtDateTime(p.crefHistory?.reviewedAt)],
      ["CREF aprovado em", fmtDateTime(p.crefHistory?.validatedAt)],
      ["CREF — reprovações anteriores", p.crefHistory?.rejectionCount ?? 0],
      ["Motivo da última reprovação do CREF", p.crefHistory?.rejectionReason],
      ["", ""],
      ["ÁREA DE ATENDIMENTO", ""],
      ["Raio de atendimento", provider.location?.serviceRadiusKm != null ? `${provider.location.serviceRadiusKm} km` : ""],
      ["Latitude", provider.location?.latitude],
      ["Longitude", provider.location?.longitude]
    );
    const sub = provider.subscription;
    profileRows.push(
      ["", ""],
      ["MINHA ASSINATURA MUVIFY", ""],
      ["Situação", sub ? translate(SUBSCRIPTION_STATUS, sub.status) : "Sem assinatura"],
      ["Plano fundador", sub ? yesNo(sub.isFounder) : ""],
      ["Valor mensal", sub ? cents(sub.priceCents) : ""],
      ["Trial até", sub ? fmtDateTime(sub.trialEndsAt) : ""],
      ["Próxima cobrança", sub ? fmtDateTime(sub.nextBillingAt) : ""],
      ["Cancelamento agendado", sub ? yesNo(sub.cancelAtPeriodEnd) : ""],
      ["Cancelada em", sub ? fmtDateTime(sub.canceledAt) : ""]
    );
    if (provider.bankAccount) {
      const b = provider.bankAccount;
      profileRows.push(
        ["", ""],
        ["CONTA BANCÁRIA", ""],
        ["Banco", b.bankName],
        ["Tipo de conta", b.accountType],
        ["Agência", b.agency],
        ["Conta", `${b.accountNumber}${b.accountDigit ? `-${b.accountDigit}` : ""}`],
        ["Titular", b.holderName],
        ["Documento do titular", b.holderDocument],
        ["Chave Pix", b.pixKey]
      );
    }
  }
  const profileSheet = workbook.addWorksheet("Meus dados");
  profileSheet.columns = [
    { header: "Campo", width: 36 },
    { header: "Valor", width: 70 }
  ];
  styleHeader(profileSheet.getRow(1));
  for (const [label, value] of profileRows) {
    const row = profileSheet.addRow([label, value === undefined || value === null ? "" : (value as ExcelJS.CellValue)]);
    row.getCell(2).alignment = { vertical: "top", wrapText: true, horizontal: "left" };
    if (label === "Valor base da sessão" || label === "Valor mensal") row.getCell(2).numFmt = MONEY_FORMAT;
    if (value === "" && label) row.getCell(1).font = { bold: true };
  }
  sheetOf.set("profile", "Meus dados");
  records.push({ name: "Meus dados", count: profileRows.length });

  // ─── Como aluno / usuário ───────────────────────────────────────────────
  type Booking = (typeof data.bookings)[number];
  addTable<Booking>("Agendamentos", data.bookings, [
    { header: "Data da sessão", value: (b) => fmtDateTime(b.scheduledAt), width: 20 },
    { header: "Situação", value: (b) => translate(BOOKING_STATUS, b.status), width: 22 },
    { header: "Valor", value: (b) => cents(b.priceCents), kind: "money", width: 14 },
    { header: "Forma de pagamento", value: (b) => translate(PAYMENT_METHOD, b.payment?.method), width: 20 },
    { header: "Situação do pagamento", value: (b) => translate(PAYMENT_STATUS, b.payment?.status), width: 24 },
    { header: "Pago em", value: (b) => fmtDateTime(b.payment?.capturedAt), width: 20 },
    { header: "Reembolsado em", value: (b) => fmtDateTime(b.payment?.refundedAt), width: 20 },
    { header: "Observações", value: (b) => b.notes, width: 40 },
    { header: "Agendado em", value: (b) => fmtDateTime(b.createdAt), width: 20 }
  ], "bookings");

  type Request = (typeof data.consultancyRequests)[number];
  addTable<Request>("Pedidos de consultoria", data.consultancyRequests, [
    { header: "Data do pedido", value: (r) => fmtDateTime(r.createdAt), width: 20 },
    { header: "Situação", value: (r) => translate(REQUEST_STATUS, r.status), width: 24 },
    { header: "Objetivo informado", value: (r) => r.trainingNeedText, width: 50 },
    { header: "Limitações informadas", value: (r) => r.limitationText, width: 50 }
  ], "consultancyRequests");

  type Contract = (typeof data.consultancyContracts)[number];
  addTable<Contract>("Consultorias contratadas", data.consultancyContracts, [
    { header: "Contratada em", value: (c) => fmtDateTime(c.createdAt), width: 20 },
    { header: "Situação", value: (c) => translate(CONTRACT_STATUS, c.status), width: 24 },
    { header: "Valor", value: (c) => cents(c.paymentAmountCents), kind: "money", width: 14 },
    { header: "Forma de pagamento", value: (c) => translate(PAYMENT_METHOD, c.paymentMethod), width: 20 },
    { header: "Situação do pagamento", value: (c) => translate(PAYMENT_STATUS, c.paymentStatus), width: 24 },
    { header: "Prazo de entrega", value: (c) => fmtDateTime(c.deliveryDeadlineAt), width: 20 },
    { header: "Entregue em", value: (c) => fmtDateTime(c.deliveredAt), width: 20 },
    { header: "Reembolsada em", value: (c) => fmtDateTime(c.refundedAt), width: 20 },
    {
      header: "Treinos recebidos",
      value: (c) => (c.trainingPlans ?? []).map((plan) => plan.title).join("; "),
      width: 50
    }
  ], "consultancyContracts");

  type Package = (typeof data.presentialPackages)[number];
  addTable<Package>("Pacotes presenciais", data.presentialPackages, [
    { header: "Contratado em", value: (p) => fmtDateTime(p.createdAt), width: 20 },
    { header: "Situação", value: (p) => translate(PACKAGE_STATUS, p.status), width: 24 },
    { header: "Modelo", value: (p) => translate(PACKAGE_MODE, p.mode), width: 18 },
    { header: "Valor por ciclo", value: (p) => cents(p.cycleAmountCents), kind: "money", width: 16 },
    { header: "Sessões por ciclo", value: (p) => p.sessionsPerCycle, kind: "number", width: 16 }
  ], "presentialPackages");

  type Review = (typeof data.reviews)[number];
  addTable<Review>("Avaliações feitas", data.reviews, [
    { header: "Data", value: (r) => fmtDateTime(r.createdAt), width: 20 },
    { header: "Nota (1 a 5)", value: (r) => r.rating, kind: "number", width: 14 },
    { header: "Comentário", value: (r) => r.comment, width: 60 }
  ], "reviews");

  type Completion = (typeof data.trainingPlanCompletions)[number];
  addTable<Completion>("Treinos concluídos", data.trainingPlanCompletions, [
    { header: "Concluído em", value: (t) => fmtDateTime(t.completedAt), width: 22 },
    { header: "Observações", value: (t) => t.notes, width: 60 }
  ], "trainingPlanCompletions");

  const anamnesisRows = data.anamnesis ? flattenAnswers(data.anamnesis.answers) : [];
  addTable("Anamnese", anamnesisRows, [
    { header: "Pergunta", value: (a) => a.label, width: 50 },
    { header: "Resposta", value: (a) => a.answer, width: 60 }
  ], "anamnesis");

  type Debt = { id: string; amountCents: number; reason: string; status: string; paidAt: Date | null; createdAt: Date };
  const debtMap = new Map<string, Debt>();
  for (const debt of [...data.debtRecords, ...(provider?.debtRecords ?? [])]) debtMap.set(debt.id, debt as Debt);
  addTable<Debt>("Pendências financeiras", [...debtMap.values()], [
    { header: "Data", value: (d) => fmtDateTime(d.createdAt), width: 20 },
    { header: "Valor", value: (d) => cents(d.amountCents), kind: "money", width: 14 },
    { header: "Motivo", value: (d) => d.reason, width: 60 },
    { header: "Situação", value: (d) => translate(DEBT_STATUS, d.status), width: 20 },
    { header: "Paga em", value: (d) => fmtDateTime(d.paidAt), width: 20 }
  ], "debtRecords");

  type Dispute = (typeof data.disputes)[number];
  addTable<Dispute>("Disputas", data.disputes, [
    { header: "Aberta em", value: (d) => fmtDateTime(d.createdAt), width: 20 },
    { header: "Tipo", value: (d) => translate(DISPUTE_TYPE, d.type), width: 32 },
    { header: "Situação", value: (d) => translate(DISPUTE_STATUS, d.status), width: 16 },
    { header: "Valor", value: (d) => cents(d.amountCents), kind: "money", width: 14 },
    { header: "Resultado", value: (d) => translate(DISPUTE_RESOLUTION, d.resolution), width: 22 },
    { header: "Valor decidido", value: (d) => cents(d.resolvedAmountCents), kind: "money", width: 16 },
    { header: "Resolvida em", value: (d) => fmtDateTime(d.resolvedAt), width: 20 },
    { header: "Observação", value: (d) => d.contextNote, width: 50 }
  ], "disputes");

  type Card = (typeof data.customerPaymentMethods)[number];
  addTable<Card>("Cartões salvos", data.customerPaymentMethods, [
    { header: "Apelido", value: (c) => c.nickname, width: 22 },
    { header: "Bandeira", value: (c) => c.brand, width: 16 },
    { header: "Final do cartão", value: (c) => c.last4, width: 16 },
    { header: "Tipo", value: (c) => translate(FUNDING, c.funding), width: 14 },
    { header: "Validade", value: (c) => (c.expMonth && c.expYear ? `${String(c.expMonth).padStart(2, "0")}/${c.expYear}` : ""), width: 12 },
    { header: "Cartão principal", value: (c) => yesNo(c.isDefault), width: 16 },
    { header: "Ativo", value: (c) => yesNo(c.isActive), width: 10 },
    { header: "Salvo em", value: (c) => fmtDateTime(c.createdAt), width: 20 }
  ], "customerPaymentMethods");

  type Message = { origem: string; data: Date; conteudo: string; automatica: boolean };
  const messages: Message[] = [
    ...data.chatMessages.map((m) => ({ origem: "Agendamento", data: m.createdAt, conteudo: m.content, automatica: m.isSystem })),
    ...data.consultancyMessages.map((m) => ({ origem: "Consultoria", data: m.createdAt, conteudo: m.content, automatica: m.isSystem }))
  ].sort((a, b) => b.data.getTime() - a.data.getTime());
  addTable<Message>("Mensagens", messages, [
    { header: "Data", value: (m) => fmtDateTime(m.data), width: 20 },
    { header: "Conversa de", value: (m) => m.origem, width: 16 },
    { header: "Mensagem", value: (m) => m.conteudo, width: 70 },
    { header: "Mensagem automática", value: (m) => yesNo(m.automatica), width: 20 }
  ], "chatMessages");

  type Notif = (typeof data.notifications)[number];
  addTable<Notif>("Notificações recebidas", data.notifications, [
    { header: "Recebida em", value: (n) => fmtDateTime(n.createdAt), width: 20 },
    { header: "Título", value: (n) => n.title, width: 34 },
    { header: "Mensagem", value: (n) => n.body, width: 60 },
    { header: "Lida em", value: (n) => fmtDateTime(n.readAt), width: 20 }
  ], "notifications");

  type ClaimedInvite = (typeof data.externalInvitesClaimed)[number];
  addTable<ClaimedInvite>("Vínculos aceitos", data.externalInvitesClaimed, [
    { header: "Aceito em", value: (i) => fmtDateTime(i.claimedAt), width: 20 },
    { header: "Situação", value: (i) => translate({ PENDING: "Pendente", CLAIMED: "Aceito", EXPIRED: "Expirado", CANCELLED: "Cancelado" }, i.status), width: 18 },
    { header: "Gerado em", value: (i) => fmtDateTime(i.createdAt), width: 20 }
  ], "externalInvitesClaimed");

  type Ticket = (typeof data.supportTickets)[number];
  addTable<Ticket>("Chamados de suporte", data.supportTickets, [
    { header: "Enviado em", value: (t) => fmtDateTime(t.createdAt), width: 20 },
    { header: "Assunto", value: (t) => t.subject, width: 30 },
    { header: "Mensagem", value: (t) => t.message, width: 60 },
    { header: "Situação", value: (t) => translate(SUPPORT_STATUS, t.status), width: 16 },
    { header: "Resposta do suporte", value: (t) => t.adminResponse, width: 60 },
    { header: "Respondido em", value: (t) => fmtDateTime(t.respondedAt), width: 20 }
  ], "supportTickets");

  // ─── Como profissional ──────────────────────────────────────────────────
  if (provider) {
    type Offer = (typeof provider.serviceOffers)[number];
    addTable<Offer>("Minhas ofertas", provider.serviceOffers, [
      { header: "Título", value: (o) => o.title, width: 36 },
      { header: "Tipo", value: (o) => translate(OFFER_KIND, o.kind), width: 30 },
      { header: "Cobrança", value: (o) => translate(BILLING_CYCLE, o.billingCycle), width: 14 },
      { header: "Valor", value: (o) => cents(o.priceCents), kind: "money", width: 14 },
      { header: "Em promoção", value: (o) => yesNo(o.isPromotion), width: 14 },
      { header: "Valor promocional", value: (o) => cents(o.promotionPriceCents), kind: "money", width: 18 },
      { header: "Criada em", value: (o) => fmtDateTime(o.createdAt), width: 20 }
    ], "provider.serviceOffers");

    type Slot = (typeof provider.availabilities)[number];
    addTable<Slot>("Horários de atendimento", provider.availabilities, [
      { header: "Dia da semana", value: (s) => WEEKDAY[s.weekday] ?? s.weekday, width: 18 },
      { header: "Início", value: (s) => s.startTime, width: 10 },
      { header: "Fim", value: (s) => s.endTime, width: 10 },
      { header: "Ativo", value: (s) => yesNo(s.isActive), width: 10 }
    ], "provider.availabilities");

    type Exer = (typeof provider.exercisesCreated)[number];
    addTable<Exer>("Exercícios criados", provider.exercisesCreated, [
      { header: "Nome", value: (e) => e.name, width: 30 },
      { header: "Categoria", value: (e) => e.category, width: 22 },
      { header: "Descrição", value: (e) => e.description, width: 44 },
      { header: "Séries/repetições padrão", value: (e) => e.defaultRepetitionsSets, width: 26 },
      { header: "Criado em", value: (e) => fmtDateTime(e.createdAt), width: 20 }
    ], "provider.exercisesCreated");

    type Plan = (typeof provider.trainingPlansAuthored)[number];
    addTable<Plan>("Fichas de treino criadas", provider.trainingPlansAuthored, [
      { header: "Título", value: (t) => t.title, width: 32 },
      { header: "Descrição", value: (t) => t.description, width: 44 },
      { header: "Criada em", value: (t) => fmtDateTime(t.createdAt), width: 20 },
      { header: "Exercícios", value: (t) => (t.exercises ?? []).map((e) => e.name).join("; "), width: 60 }
    ], "provider.trainingPlansAuthored");

    type CalEvent = (typeof provider.calendarEvents)[number];
    addTable<CalEvent>("Agenda pessoal", provider.calendarEvents, [
      { header: "Título", value: (e) => e.title, width: 30 },
      { header: "Descrição", value: (e) => e.description, width: 44 },
      { header: "Início", value: (e) => fmtDateTime(e.startsAt), width: 20 },
      { header: "Fim", value: (e) => fmtDateTime(e.endsAt), width: 20 }
    ], "provider.calendarEvents");

    type Block = (typeof provider.manualBlocks)[number];
    addTable<Block>("Bloqueios manuais na agenda", provider.manualBlocks, [
      { header: "Data", value: (b) => b.date, width: 14 },
      { header: "Início", value: (b) => b.startTime, width: 10 },
      { header: "Fim", value: (b) => b.endTime, width: 10 },
      { header: "Motivo", value: (b) => b.label, width: 30 },
      { header: "Local", value: (b) => b.location, width: 26 }
    ], "provider.manualBlocks");

    type Invite = (typeof provider.externalStudentInvites)[number];
    addTable<Invite>("Convites a alunos externos", provider.externalStudentInvites, [
      { header: "Nome do aluno", value: (i) => i.studentName, width: 30 },
      { header: "Canal", value: (i) => translate({ WHATSAPP: "WhatsApp", EMAIL: "E-mail" }, i.channel), width: 14 },
      { header: "Situação", value: (i) => translate({ PENDING: "Pendente", CLAIMED: "Aceito", EXPIRED: "Expirado", CANCELLED: "Cancelado" }, i.status), width: 16 },
      { header: "Enviado em", value: (i) => fmtDateTime(i.createdAt), width: 20 },
      { header: "Aceito em", value: (i) => fmtDateTime(i.claimedAt), width: 20 }
    ], "provider.externalStudentInvites");

    type Received = (typeof provider.bookingsReceived)[number];
    addTable<Received>("Sessões recebidas", provider.bookingsReceived, [
      { header: "Data da sessão", value: (b) => fmtDateTime(b.scheduledAt), width: 20 },
      { header: "Situação", value: (b) => translate(BOOKING_STATUS, b.status), width: 22 },
      { header: "Valor", value: (b) => cents(b.priceCents), kind: "money", width: 14 },
      { header: "Agendada em", value: (b) => fmtDateTime(b.createdAt), width: 20 }
    ], "provider.bookingsReceived");

    type ProviderContract = (typeof provider.consultancyContractsAsProvider)[number];
    addTable<ProviderContract>("Consultorias vendidas", provider.consultancyContractsAsProvider, [
      { header: "Contratada em", value: (c) => fmtDateTime(c.createdAt), width: 20 },
      { header: "Situação", value: (c) => translate(CONTRACT_STATUS, c.status), width: 24 },
      { header: "Valor pago pelo aluno", value: (c) => cents(c.paymentAmountCents), kind: "money", width: 22 },
      { header: "Valor repassado a você", value: (c) => cents(c.providerAmountCents), kind: "money", width: 22 }
    ], "provider.consultancyContractsAsProvider");

    type Offered = (typeof provider.presentialPackagesOffered)[number];
    addTable<Offered>("Pacotes vendidos", provider.presentialPackagesOffered, [
      { header: "Contratado em", value: (p) => fmtDateTime(p.createdAt), width: 20 },
      { header: "Situação", value: (p) => translate(PACKAGE_STATUS, p.status), width: 24 },
      { header: "Modelo", value: (p) => translate(PACKAGE_MODE, p.mode), width: 18 },
      { header: "Valor por ciclo", value: (p) => cents(p.cycleAmountCents), kind: "money", width: 16 }
    ], "provider.presentialPackagesOffered");

    type ReviewReceived = (typeof provider.reviewsReceived)[number];
    addTable<ReviewReceived>("Avaliações recebidas", provider.reviewsReceived, [
      { header: "Data", value: (r) => fmtDateTime(r.createdAt), width: 20 },
      { header: "Nota (1 a 5)", value: (r) => r.rating, kind: "number", width: 14 },
      { header: "Comentário do aluno", value: (r) => r.comment, width: 60 },
      { header: "Sua resposta", value: (r) => r.providerResponse, width: 60 }
    ], "provider.reviewsReceived");

    type Student = (typeof provider.financialStudents)[number];
    addTable<Student>("Alunos (financeiro)", provider.financialStudents, [
      { header: "Nome", value: (s) => s.name, width: 30 },
      { header: "Mensalidade", value: (s) => cents(s.monthlyValueCents), kind: "money", width: 16 },
      { header: "Tipo", value: (s) => translate(STUDENT_TYPE, s.type), width: 20 },
      { header: "Ativo", value: (s) => yesNo(s.isActive), width: 10 },
      { header: "Cadastrado em", value: (s) => fmtDateTime(s.createdAt), width: 20 }
    ], "provider.financialStudents");

    type Income = (typeof provider.financialIncomes)[number];
    addTable<Income>("Receitas", provider.financialIncomes, [
      { header: "Data", value: (i) => fmtDate(i.paidAt), width: 14 },
      { header: "Descrição", value: (i) => i.description, width: 44 },
      { header: "Valor", value: (i) => cents(i.amountCents), kind: "money", width: 14 },
      { header: "Origem", value: (i) => translate(INCOME_SOURCE, i.source), width: 20 }
    ], "provider.financialIncomes");

    type Expense = (typeof provider.financialExpenses)[number];
    addTable<Expense>("Despesas", provider.financialExpenses, [
      { header: "Data", value: (e) => fmtDate(e.paidAt), width: 14 },
      { header: "Descrição", value: (e) => e.description, width: 44 },
      { header: "Valor", value: (e) => cents(e.amountCents), kind: "money", width: 14 },
      { header: "Categoria", value: (e) => translate(EXPENSE_CATEGORY, e.category), width: 24 }
    ], "provider.financialExpenses");

    type Goal = (typeof provider.financialGoals)[number];
    addTable<Goal>("Metas financeiras", provider.financialGoals, [
      { header: "Mês", value: (g) => g.month, width: 12 },
      { header: "Meta de faturamento", value: (g) => cents(g.targetRevenueCents), kind: "money", width: 20 },
      { header: "Meta de alunos ativos", value: (g) => g.targetStudents, kind: "number", width: 22 },
      { header: "Meta de aulas por semana", value: (g) => g.targetWeeklyClasses, kind: "number", width: 24 }
    ], "provider.financialGoals");
  }

  // ─── Resumo: toda seção do arquivo técnico, com contagem e onde ver ─────
  const countOf = (value: unknown): number => {
    if (Array.isArray(value)) return value.length;
    return value ? 1 : 0;
  };
  const sections: Array<{ label: string; key: string; count: number }> = [
    { label: "Dados de cadastro", key: "profile", count: 1 },
    { label: "Agendamentos e pagamentos", key: "bookings", count: countOf(data.bookings) },
    { label: "Pedidos de consultoria", key: "consultancyRequests", count: countOf(data.consultancyRequests) },
    { label: "Consultorias contratadas", key: "consultancyContracts", count: countOf(data.consultancyContracts) },
    { label: "Pacotes presenciais", key: "presentialPackages", count: countOf(data.presentialPackages) },
    { label: "Avaliações feitas", key: "reviews", count: countOf(data.reviews) },
    { label: "Treinos concluídos", key: "trainingPlanCompletions", count: countOf(data.trainingPlanCompletions) },
    { label: "Anamnese (questionário de saúde)", key: "anamnesis", count: countOf(data.anamnesis) },
    { label: "Pendências financeiras", key: "debtRecords", count: debtMap.size },
    { label: "Disputas", key: "disputes", count: countOf(data.disputes) },
    { label: "Cartões salvos", key: "customerPaymentMethods", count: countOf(data.customerPaymentMethods) },
    { label: "Mensagens de conversas", key: "chatMessages", count: messages.length },
    { label: "Notificações recebidas", key: "notifications", count: countOf(data.notifications) },
    { label: "Vínculos aceitos com profissionais fora do app", key: "externalInvitesClaimed", count: countOf(data.externalInvitesClaimed) },
    { label: "Chamados de suporte", key: "supportTickets", count: countOf(data.supportTickets) }
  ];
  if (provider) {
    sections.push(
      { label: "Minhas ofertas", key: "provider.serviceOffers", count: countOf(provider.serviceOffers) },
      { label: "Horários de atendimento", key: "provider.availabilities", count: countOf(provider.availabilities) },
      { label: "Exercícios criados", key: "provider.exercisesCreated", count: countOf(provider.exercisesCreated) },
      { label: "Fichas de treino criadas", key: "provider.trainingPlansAuthored", count: countOf(provider.trainingPlansAuthored) },
      { label: "Agenda pessoal", key: "provider.calendarEvents", count: countOf(provider.calendarEvents) },
      { label: "Bloqueios manuais na agenda", key: "provider.manualBlocks", count: countOf(provider.manualBlocks) },
      { label: "Convites enviados a alunos externos", key: "provider.externalStudentInvites", count: countOf(provider.externalStudentInvites) },
      { label: "Sessões recebidas", key: "provider.bookingsReceived", count: countOf(provider.bookingsReceived) },
      { label: "Consultorias vendidas", key: "provider.consultancyContractsAsProvider", count: countOf(provider.consultancyContractsAsProvider) },
      { label: "Pacotes vendidos", key: "provider.presentialPackagesOffered", count: countOf(provider.presentialPackagesOffered) },
      { label: "Avaliações recebidas", key: "provider.reviewsReceived", count: countOf(provider.reviewsReceived) },
      { label: "Alunos (financeiro)", key: "provider.financialStudents", count: countOf(provider.financialStudents) },
      { label: "Receitas", key: "provider.financialIncomes", count: countOf(provider.financialIncomes) },
      { label: "Despesas", key: "provider.financialExpenses", count: countOf(provider.financialExpenses) },
      { label: "Metas financeiras", key: "provider.financialGoals", count: countOf(provider.financialGoals) }
    );
  }
  const technicalOnly: Array<{ label: string; count: number }> = [
    { label: "Publicações, curtidas e comentários da comunidade", count: data.feedPosts.length + data.feedPostLikes.length + data.feedPostComments.length },
    { label: "Quem você segue e quem segue você", count: data.following.length + data.followers.length },
    { label: "Favoritos", count: data.favorites.length },
    { label: "Conquistas e pontos de experiência", count: data.unlockedAchievements.length + data.xpTransactions.length },
    { label: "Sequência de treinos e ranking", count: countOf(data.streak) + data.rankingSnapshots.length },
    { label: "Denúncias enviadas", count: data.feedPostReports.length + data.bookingMessageReports.length + data.consultancyMessageReports.length },
    { label: "Faltas registradas ou recebidas", count: data.noShowReportsFiled.length + data.noShowReportsReceived.length },
    { label: "Avaliações físicas", count: data.physicalAssessments.length },
    { label: "Comprovações de presença (fotos)", count: data.completionEvidences.length },
    { label: "Histórico de consentimentos", count: data.consentRecords.length },
    { label: "Aparelhos conectados e sessões de login", count: data.pushDevices.length + data.sessions.length },
    { label: "Preferências de notificação", count: data.notificationPreferences.length },
    { label: "Documentos enviados (CREF)", count: data.crefDocumentUploads.length }
  ];

  summary.columns = [
    { header: "O que é", width: 52 },
    { header: "Registros", width: 12 },
    { header: "Onde ver", width: 44 }
  ];
  styleHeader(summary.getRow(1));
  for (const section of sections) {
    const sheetName = sheetOf.get(section.key);
    summary.addRow([section.label, section.count, sheetName ? `Aba "${sheetName}"` : section.count === 0 ? "Sem registros" : TECHNICAL_ONLY]);
  }
  for (const item of technicalOnly) {
    summary.addRow([item.label, item.count, item.count === 0 ? "Sem registros" : TECHNICAL_ONLY]);
  }
  summary.views = [{ state: "frozen", ySplit: 1 }];

  // ─── Leia-me ────────────────────────────────────────────────────────────
  const truncatedSections = Object.entries(data.truncated ?? {})
    .filter(([, isTruncated]) => Boolean(isTruncated))
    .map(([key]) => key);
  guide.columns = [{ header: "Seus dados no Muvify", width: 110 }];
  styleHeader(guide.getRow(1));
  const guideLines = [
    `Exportado em ${fmtDateTime(data.exportedAt)} (horário de Brasília).`,
    "",
    "O que é este arquivo",
    "Esta planilha reúne, de forma organizada, os dados pessoais que o Muvify guarda sobre você. Cada aba trata de um assunto (agendamentos, pagamentos, mensagens etc.).",
    "",
    "Como ler",
    "• A aba \"Resumo\" lista todos os tipos de dado e diz em qual aba (ou arquivo) cada um está.",
    "• Valores em reais aparecem como R$; datas e horários seguem o horário de Brasília.",
    "• Você pode filtrar e ordenar qualquer aba usando as setas do cabeçalho.",
    "",
    "O que não está nesta planilha",
    "Fotos, comprovações de presença e alguns dados técnicos (aparelhos, sessões de login, curtidas etc.) ficam no arquivo técnico (JSON), que é a cópia completa e serve para levar seus dados a outro serviço. A aba \"Resumo\" mostra quais dados estão só nele."
  ];
  if (truncatedSections.length > 0) {
    guideLines.push(
      "",
      "Atenção: limite de registros",
      "Algumas listas são muito grandes e trazem apenas os 500 registros mais recentes. Para receber o histórico completo, fale com a gente pelo canal de privacidade (muvifyadm@gmail.com)."
    );
  }
  guideLines.push("", "Dúvidas sobre seus dados: muvifyadm@gmail.com");
  for (const line of guideLines) {
    const row = guide.addRow([line]);
    row.alignment = { wrapText: true, vertical: "top" };
    if (["O que é este arquivo", "Como ler", "O que não está nesta planilha", "Atenção: limite de registros"].includes(line)) {
      row.font = { bold: true };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
