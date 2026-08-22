import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
// Épico de Frentes, Frente 10, Lote 3: as rotas de escrita do admin usavam
// uploadRateLimiter (20/hora, mensagem sobre "upload" sem sentido nesse
// contexto) - writeRateLimiter já existe desde a Frente 5 exatamente pra
// esse padrão.
import { writeRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { AdminController } from "../controllers/admin.controller";
import {
  adminChangeUserRoleSchema,
  adminChatAuditSessionMessagesSchema,
  adminChatAuditSessionsQuerySchema,
  adminClearLegalHoldSchema,
  adminCrefQueueQuerySchema,
  adminDataRetentionRunsQuerySchema,
  adminDashboardOverviewSchema,
  adminDisputeCaseIdSchema,
  adminExportUserDataSchema,
  adminListDebtsQuerySchema,
  adminListNoShowReportsSchema,
  adminListDisputeCasesQuerySchema,
  adminListReportsSchema,
  adminReportActionSchema,
  adminLookupBookingDetailSchema,
  adminLookupBookingsSchema,
  adminLookupChatsSchema,
  adminLookupCrefSchema,
  adminReactivateUserSchema,
  adminResolveDisputeCaseSchema,
  adminRunDataRetentionSchema,
  adminSearchUsersSchema,
  adminSetLegalHoldSchema,
  adminAuditLogsQuerySchema,
  adminWaitlistSignupsQuerySchema,
  adminSuspendUserSchema,
  adminSupportQueueQuerySchema,
  adminSupportReplySchema,
  adminSupportTicketDetailSchema,
  adminUserDetailSchema,
  adminWriteOffDebtSchema,
  reviewProviderCrefSchema
} from "../validators/admin.validator";
import {
  createPrebuiltExerciseSchema,
  exerciseIdSchema,
  listExercisesSchema,
  updatePrebuiltExerciseSchema
} from "../../exercises/validators/exercise.validator";

const adminController = new AdminController();
export const adminRoutes = Router();

adminRoutes.use(ensureAuthenticated);
adminRoutes.use(ensureRole(UserRole.ADMIN));

/**
 * @swagger
 * /admin/dashboard/overview:
 *   get:
 *     summary: Painel geral do admin (faturamento, filas de atenção, rankings)
 *     tags: [Admin]
 */
adminRoutes.get(
  "/dashboard/overview",
  validate(adminDashboardOverviewSchema),
  adminController.dashboardOverview
);

// Épico de Frentes, Frente 10, Lote 5: AdminAuditLog só era escrito, nunca
// lido - não existia nenhum endpoint de consulta.
/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     summary: Consulta a trilha de auditoria administrativa
 *     tags: [Admin]
 */
adminRoutes.get(
  "/audit-logs",
  validate(adminAuditLogsQuerySchema),
  adminController.getAuditLogs
);

// Lista de espera pré-lançamento: cadastros só existiam pra consultar
// direto no banco - endpoint de leitura, mesmo padrão de /audit-logs.
/**
 * @swagger
 * /admin/waitlist-signups:
 *   get:
 *     summary: Lista cadastros da lista de espera pré-lançamento, com filtros
 *     tags: [Admin]
 */
adminRoutes.get(
  "/waitlist-signups",
  validate(adminWaitlistSignupsQuerySchema),
  adminController.getWaitlistSignups
);

/**
 * @swagger
 * /admin/cref/requests:
 *   get:
 *     summary: Fila de validação de CREF
 *     tags: [Admin]
 */
adminRoutes.get(
  "/cref/requests",
  validate(adminCrefQueueQuerySchema),
  adminController.listCrefValidationQueue
);

/**
 * @swagger
 * /admin/cref/requests/{providerId}:
 *   patch:
 *     summary: Aprova ou rejeita o CREF de um profissional
 *     tags: [Admin]
 */
adminRoutes.patch(
  "/cref/requests/:providerId",
  writeRateLimiter,
  validate(reviewProviderCrefSchema),
  adminController.reviewProviderCref
);

/**
 * @swagger
 * /admin/support/tickets:
 *   get:
 *     summary: Fila de chamados de suporte
 *     tags: [Admin]
 */
adminRoutes.get(
  "/support/tickets",
  validate(adminSupportQueueQuerySchema),
  adminController.listSupportTickets
);
/**
 * @swagger
 * /admin/support/tickets/{ticketId}:
 *   get:
 *     summary: Detalhe de um chamado de suporte
 *     tags: [Admin]
 */
adminRoutes.get(
  "/support/tickets/:ticketId",
  validate(adminSupportTicketDetailSchema),
  adminController.getSupportTicketDetail
);

/**
 * @swagger
 * /admin/support/tickets/{ticketId}/respond:
 *   patch:
 *     summary: Responde um chamado de suporte
 *     tags: [Admin]
 */
adminRoutes.patch(
  "/support/tickets/:ticketId/respond",
  writeRateLimiter,
  validate(adminSupportReplySchema),
  adminController.replySupportTicket
);

/**
 * @swagger
 * /admin/data-retention/runs:
 *   get:
 *     summary: Histórico de execuções da política de retenção de dados
 *     tags: [Admin]
 */
adminRoutes.get(
  "/data-retention/runs",
  validate(adminDataRetentionRunsQuerySchema),
  adminController.listDataRetentionRuns
);

/**
 * @swagger
 * /admin/data-retention/run:
 *   post:
 *     summary: Dispara uma execução da política de retenção de dados
 *     tags: [Admin]
 */
adminRoutes.post(
  "/data-retention/run",
  writeRateLimiter,
  validate(adminRunDataRetentionSchema),
  adminController.runDataRetention
);

/**
 * @swagger
 * /admin/chat-audit/sessions:
 *   get:
 *     summary: Lista sessões de chat pra auditoria
 *     tags: [Admin]
 */
adminRoutes.get(
  "/chat-audit/sessions",
  validate(adminChatAuditSessionsQuerySchema),
  adminController.listChatAuditSessions
);

/**
 * @swagger
 * /admin/chat-audit/sessions/{bookingId}/messages:
 *   get:
 *     summary: Mensagens de uma sessão de chat pra auditoria
 *     tags: [Admin]
 */
adminRoutes.get(
  "/chat-audit/sessions/:bookingId/messages",
  validate(adminChatAuditSessionMessagesSchema),
  adminController.getChatAuditSessionMessages
);

/**
 * @swagger
 * /admin/lookup/cref:
 *   get:
 *     summary: Busca CREF por CPF do profissional
 *     tags: [Admin]
 */
adminRoutes.get("/lookup/cref", validate(adminLookupCrefSchema), adminController.lookupCref);
/**
 * @swagger
 * /admin/lookup/chats:
 *   get:
 *     summary: Busca chats por CPF do cliente e do profissional
 *     tags: [Admin]
 */
adminRoutes.get("/lookup/chats", validate(adminLookupChatsSchema), adminController.lookupChats);
/**
 * @swagger
 * /admin/lookup/bookings:
 *   get:
 *     summary: Busca agendamentos por CPF do cliente e do profissional
 *     tags: [Admin]
 */
adminRoutes.get("/lookup/bookings", validate(adminLookupBookingsSchema), adminController.lookupBookings);
/**
 * @swagger
 * /admin/lookup/bookings/{bookingId}:
 *   get:
 *     summary: Detalhe de um agendamento localizado por CPF
 *     tags: [Admin]
 */
adminRoutes.get("/lookup/bookings/:bookingId", validate(adminLookupBookingDetailSchema), adminController.lookupBookingDetail);
/**
 * @swagger
 * /admin/no-show-reports:
 *   get:
 *     summary: Lista denúncias de falta (no-show), filtrável por reincidência
 *     tags: [Admin]
 */
adminRoutes.get(
  "/no-show-reports",
  validate(adminListNoShowReportsSchema),
  adminController.listNoShowReports
);

/**
 * @swagger
 * /admin/users/{userId}/suspend:
 *   post:
 *     summary: Suspende a conta de um usuário
 *     tags: [Admin]
 */
adminRoutes.post(
  "/users/:userId/suspend",
  writeRateLimiter,
  validate(adminSuspendUserSchema),
  adminController.suspendUser
);
/**
 * @swagger
 * /admin/users/{userId}/reactivate:
 *   post:
 *     summary: Reativa a conta de um usuário suspenso
 *     tags: [Admin]
 */
adminRoutes.post(
  "/users/:userId/reactivate",
  writeRateLimiter,
  validate(adminReactivateUserSchema),
  adminController.reactivateUser
);
/**
 * @swagger
 * /admin/users/{userId}/role:
 *   patch:
 *     summary: Troca o tipo de conta (CLIENT/PROVIDER) de um usuário
 *     tags: [Admin]
 */
adminRoutes.patch(
  "/users/:userId/role",
  writeRateLimiter,
  validate(adminChangeUserRoleSchema),
  adminController.changeUserRole
);
/**
 * @swagger
 * /admin/users/{userId}/legal-hold:
 *   post:
 *     summary: Aplica legal hold num usuário (impede retenção automática)
 *     tags: [Admin]
 */
adminRoutes.post(
  "/users/:userId/legal-hold",
  writeRateLimiter,
  validate(adminSetLegalHoldSchema),
  adminController.setLegalHold
);
/**
 * @swagger
 * /admin/users/{userId}/legal-hold:
 *   delete:
 *     summary: Remove o legal hold de um usuário
 *     tags: [Admin]
 */
adminRoutes.delete(
  "/users/:userId/legal-hold",
  writeRateLimiter,
  validate(adminClearLegalHoldSchema),
  adminController.clearLegalHold
);
/**
 * @swagger
 * /admin/users/{userId}/export-data:
 *   post:
 *     summary: Exporta os dados pessoais de um usuário (LGPD)
 *     tags: [Admin]
 */
adminRoutes.post(
  "/users/:userId/export-data",
  writeRateLimiter,
  validate(adminExportUserDataSchema),
  adminController.exportUserData
);

/**
 * @swagger
 * /admin/users/search:
 *   get:
 *     summary: Busca usuários por nome ou e-mail
 *     tags: [Admin]
 */
adminRoutes.get(
  "/users/search",
  validate(adminSearchUsersSchema),
  adminController.searchUsers
);
/**
 * @swagger
 * /admin/users/{userId}:
 *   get:
 *     summary: Detalhe completo de um usuário (dívidas, disputas, moderação)
 *     tags: [Admin]
 */
adminRoutes.get(
  "/users/:userId",
  validate(adminUserDetailSchema),
  adminController.getUserDetail
);

/**
 * @swagger
 * /admin/debts:
 *   get:
 *     summary: Lista dívidas registradas na plataforma
 *     tags: [Admin]
 */
adminRoutes.get(
  "/debts",
  validate(adminListDebtsQuerySchema),
  adminController.listDebts
);
/**
 * @swagger
 * /admin/debts/{debtId}/write-off:
 *   post:
 *     summary: Dá baixa (perdão) numa dívida
 *     tags: [Admin]
 */
adminRoutes.post(
  "/debts/:debtId/write-off",
  writeRateLimiter,
  validate(adminWriteOffDebtSchema),
  adminController.writeOffDebt
);

/**
 * @swagger
 * /admin/disputes:
 *   get:
 *     summary: Lista casos de disputa
 *     tags: [Admin]
 */
adminRoutes.get(
  "/disputes",
  validate(adminListDisputeCasesQuerySchema),
  adminController.listDisputeCases
);
/**
 * @swagger
 * /admin/disputes/{caseId}:
 *   get:
 *     summary: Detalhe de um caso de disputa
 *     tags: [Admin]
 */
adminRoutes.get(
  "/disputes/:caseId",
  validate(adminDisputeCaseIdSchema),
  adminController.getDisputeCaseDetail
);
/**
 * @swagger
 * /admin/disputes/{caseId}/resolve:
 *   post:
 *     summary: Resolve um caso de disputa (reembolso, negado, nova captura)
 *     tags: [Admin]
 */
adminRoutes.post(
  "/disputes/:caseId/resolve",
  writeRateLimiter,
  validate(adminResolveDisputeCaseSchema),
  adminController.resolveDisputeCase
);

// Épico de Frentes, Frente 10, Lote 1: fila unificada de moderação de
// denúncias (post, chat de agendamento, chat de consultoria) - antes não
// existia nenhum endpoint que lesse essas 3 tabelas.
/**
 * @swagger
 * /admin/reports:
 *   get:
 *     summary: Fila unificada de denúncias (post, chat de agendamento, chat de consultoria)
 *     tags: [Admin]
 */
adminRoutes.get("/reports", validate(adminListReportsSchema), adminController.listReports);
/**
 * @swagger
 * /admin/reports/{type}/{id}/dismiss:
 *   patch:
 *     summary: Descarta uma denúncia sem agir sobre o conteúdo
 *     tags: [Admin]
 */
adminRoutes.patch(
  "/reports/:type/:id/dismiss",
  writeRateLimiter,
  validate(adminReportActionSchema),
  adminController.dismissReport
);
/**
 * @swagger
 * /admin/reports/{type}/{id}/hide-content:
 *   patch:
 *     summary: Oculta o conteúdo denunciado (some pra todo mundo, reversível)
 *     tags: [Admin]
 */
adminRoutes.patch(
  "/reports/:type/:id/hide-content",
  writeRateLimiter,
  validate(adminReportActionSchema),
  adminController.hideReportedContent
);
/**
 * @swagger
 * /admin/reports/{type}/{id}/unhide-content:
 *   patch:
 *     summary: Reverte a ocultação de um conteúdo denunciado (desfaz hide-content)
 *     tags: [Admin]
 */
adminRoutes.patch(
  "/reports/:type/:id/unhide-content",
  writeRateLimiter,
  validate(adminReportActionSchema),
  adminController.unhideReportedContent
);

/**
 * @swagger
 * /admin/exercises:
 *   get:
 *     summary: Lista exercícios pré-montados (catálogo Muvify)
 *     tags: [Admin]
 */
adminRoutes.get("/exercises", validate(listExercisesSchema), adminController.listPrebuiltExercises.bind(adminController));
/**
 * @swagger
 * /admin/exercises:
 *   post:
 *     summary: Cria um exercício pré-montado no catálogo
 *     tags: [Admin]
 */
adminRoutes.post("/exercises", writeRateLimiter, validate(createPrebuiltExerciseSchema), adminController.createPrebuiltExercise.bind(adminController));
/**
 * @swagger
 * /admin/exercises/{exerciseId}:
 *   patch:
 *     summary: Edita um exercício pré-montado do catálogo
 *     tags: [Admin]
 */
adminRoutes.patch("/exercises/:exerciseId", writeRateLimiter, validate(updatePrebuiltExerciseSchema), adminController.updatePrebuiltExercise.bind(adminController));
/**
 * @swagger
 * /admin/exercises/{exerciseId}:
 *   delete:
 *     summary: Remove um exercício pré-montado do catálogo
 *     tags: [Admin]
 */
adminRoutes.delete("/exercises/:exerciseId", writeRateLimiter, validate(exerciseIdSchema), adminController.deletePrebuiltExercise.bind(adminController));
