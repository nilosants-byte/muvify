/**
 * Registro central de query keys do TanStack Query.
 *
 * Cada domínio agrupa suas chaves. Parâmetros que afetam o resultado da query
 * fazem parte da chave — garantindo que o cache seja separado por contexto
 * (ex: financeiro de meses diferentes ficam em caches independentes).
 *
 * Uso:
 *   useAuthQuery(queryKeys.financial.dashboard(month), t => financialApi.dashboard(t, month))
 *   queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
 */

export const queryKeys = {

  // ── Usuário ────────────────────────────────────────────────────────────────
  user: {
    all: ["user"] as const,
    me: () => ["user", "me"] as const,
    anamnesis: () => ["user", "anamnesis"] as const,
    recoveryEmail: () => ["user", "recoveryEmail"] as const,
    bankAccount: () => ["user", "bankAccount"] as const,
    profilePage: () => ["user", "profilePage"] as const,
  },

  // ── Notificações ───────────────────────────────────────────────────────────
  notifications: {
    all: ["notifications"] as const,
    inbox: (take?: number) => ["notifications", "inbox", take] as const,
    unreadCount: () => ["notifications", "unreadCount"] as const,
    devices: () => ["notifications", "devices"] as const,
  },

  // ── Categorias ─────────────────────────────────────────────────────────────
  categories: {
    all: ["categories"] as const,
    list: () => ["categories", "list"] as const,
  },

  // ── Profissionais (perfil público) ─────────────────────────────────────────
  providers: {
    all: ["providers"] as const,
    list: (params?: object) => ["providers", "list", params] as const,
    detail: (id: string) => ["providers", "detail", id] as const,
    schedulePreview: (id: string, params?: object) => ["providers", "schedulePreview", id, params] as const,
    myCredentials: () => ["providers", "myCredentials"] as const,
    dashboardStudents: () => ["providers", "dashboardStudents"] as const,
    dashboardStudentDetail: (clientId: string) => ["providers", "dashboardStudentDetail", clientId] as const,
    studentAnamnesis: (clientId: string) => ["providers", "studentAnamnesis", clientId] as const,
    timeline: () => ["providers", "timeline"] as const,
    profile: () => ["providers", "profile"] as const,
    home: () => ["providers", "home"] as const,
  },

  // ── Agenda (dados combinados por tela) ─────────────────────────────────────
  agenda: {
    all: ["agenda"] as const,
    professional: () => ["agenda", "professional"] as const,
  },

  // ── Disponibilidade ────────────────────────────────────────────────────────
  availability: {
    all: ["availability"] as const,
    me: () => ["availability", "me"] as const,
    manualBlocks: () => ["availability", "manualBlocks"] as const,
  },

  // ── Agendamentos ───────────────────────────────────────────────────────────
  bookings: {
    all: ["bookings"] as const,
    me: () => ["bookings", "me"] as const,
    detail: (id: string) => ["bookings", "detail", id] as const,
    providerDetail: (id: string) => ["bookings", "providerDetail", id] as const,
    archivedClient: (params?: object) => ["bookings", "archivedClient", params] as const,
    archivedProvider: (params?: object) => ["bookings", "archivedProvider", params] as const,
  },

  // ── Chat ───────────────────────────────────────────────────────────────────
  chat: {
    all: ["chat"] as const,
    myChats: () => ["chat", "myChats"] as const,
    messages: (bookingId: string) => ["chat", "messages", bookingId] as const,
    otherUser: (bookingId: string) => ["chat", "otherUser", bookingId] as const,
  },

  // ── Favoritos ──────────────────────────────────────────────────────────────
  favorites: {
    all: ["favorites"] as const,
    list: () => ["favorites", "list"] as const,
  },

  // ── Pagamentos ─────────────────────────────────────────────────────────────
  payments: {
    all: ["payments"] as const,
    customerStatus: () => ["payments", "customerStatus"] as const,
    providerStatus: () => ["payments", "providerStatus"] as const,
    providerPayouts: () => ["payments", "providerPayouts"] as const,
    providerAccount: () => ["payments", "providerAccount"] as const,
    bookingPayment: (id: string) => ["payments", "bookingPayment", id] as const,
    setupIntent: () => ["payments", "setupIntent"] as const,
  },

  // ── Financeiro (personal finance do profissional) ──────────────────────────
  financial: {
    all: ["financial"] as const,
    dashboard: (month?: string) => ["financial", "dashboard", month] as const,
    report: (months?: number) => ["financial", "report", months] as const,
    payouts: () => ["financial", "payouts"] as const,
    appClients: (month?: string) => ["financial", "appClients", month] as const,
    students: () => ["financial", "students"] as const,
    studentsPage: (month?: string) => ["financial", "studentsPage", month] as const,
    incomes: (month?: string) => ["financial", "incomes", month] as const,
    expenses: (month?: string) => ["financial", "expenses", month] as const,
    goal: (month?: string) => ["financial", "goal", month] as const,
    sessions: (month?: string) => ["financial", "sessions", month] as const,
    financePage: (month?: string) => ["financial", "financePage", month] as const,
    history: (month?: string) => ["financial", "history", month] as const,
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  admin: {
    all: ["admin"] as const,
    dashboard: (params?: object) => ["admin", "dashboard", params] as const,
    crefRequests: (params?: object) => ["admin", "crefRequests", params] as const,
    supportTickets: (params?: object) => ["admin", "supportTickets", params] as const,
    chatAuditSessions: (params?: object) => ["admin", "chatAuditSessions", params] as const,
    chatAuditMessages: (bookingId: string, params?: object) => ["admin", "chatAuditMessages", bookingId, params] as const,
    lookupCref: (doc: string) => ["admin", "lookupCref", doc] as const,
    lookupBookingDetail: (id: string) => ["admin", "lookupBookingDetail", id] as const,
    disputeCases: (params?: object) => ["admin", "disputeCases", params] as const,
    disputeCaseDetail: (caseId: string) => ["admin", "disputeCaseDetail", caseId] as const,
    debts: (params?: object) => ["admin", "debts", params] as const,
    noShowReports: (params?: object) => ["admin", "noShowReports", params] as const,
  },

  // ── Exercícios ─────────────────────────────────────────────────────────────
  exercises: {
    all: ["exercises"] as const,
    list: (params?: object) => ["exercises", "list", params] as const,
    mine: (params?: object) => ["exercises", "mine", params] as const,
    prebuilt: (params?: object) => ["exercises", "prebuilt", params] as const,
    adminList: (params?: object) => ["exercises", "adminList", params] as const,
    trainingScreen: () => ["exercises", "trainingScreen"] as const,
  },

  // ── Consultoria ────────────────────────────────────────────────────────────
  consultancy: {
    all: ["consultancy"] as const,
    promotions: () => ["consultancy", "promotions"] as const,
    catalog: (providerId: string) => ["consultancy", "catalog", providerId] as const,
    myTraining: () => ["consultancy", "myTraining"] as const,
    myRequests: () => ["consultancy", "myRequests"] as const,
    myArchivedRequests: (params?: object) => ["consultancy", "myArchivedRequests", params] as const,
    providerCenter: () => ["consultancy", "providerCenter"] as const,
    providerArchivedRequests: (params?: object) => ["consultancy", "providerArchivedRequests", params] as const,
  },

  // ── Pacote presencial ──────────────────────────────────────────────────────
  presentialPackages: {
    all: ["presentialPackages"] as const,
    myList: () => ["presentialPackages", "myList"] as const,
    providerList: () => ["presentialPackages", "providerList"] as const,
    detail: (packageId: string) => ["presentialPackages", "detail", packageId] as const,
  },
  debts: {
    all: ["debts"] as const,
    my: () => ["debts", "my"] as const,
    providerList: () => ["debts", "providerList"] as const,
  },

  // ── Comunidade ─────────────────────────────────────────────────────────────
  community: {
    all: ["community"] as const,
    followers: (page?: number, limit?: number) => ["community", "followers", page, limit] as const,
    following: (page?: number, limit?: number) => ["community", "following", page, limit] as const,
    searchUsers: (query: string, page?: number) => ["community", "searchUsers", query, page] as const,
    userProfile: (userId: string) => ["community", "userProfile", userId] as const,
    ranking: (period?: string, page?: number) => ["community", "ranking", period, page] as const,
    feed: (page?: number) => ["community", "feed", page] as const,
    comments: (postId: string, page?: number) => ["community", "comments", postId, page] as const,
    suggestions: (limit?: number) => ["community", "suggestions", limit] as const,
    newFollowers: () => ["community", "newFollowers"] as const,
  },

  // ── Gamificação ────────────────────────────────────────────────────────────
  gamification: {
    all: ["gamification"] as const,
    myProfile: () => ["gamification", "myProfile"] as const,
    achievements: () => ["gamification", "achievements"] as const,
  },

} as const;
