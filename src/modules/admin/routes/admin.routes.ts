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

adminRoutes.get(
  "/dashboard/overview",
  validate(adminDashboardOverviewSchema),
  adminController.dashboardOverview
);

// Épico de Frentes, Frente 10, Lote 5: AdminAuditLog só era escrito, nunca
// lido - não existia nenhum endpoint de consulta.
adminRoutes.get(
  "/audit-logs",
  validate(adminAuditLogsQuerySchema),
  adminController.getAuditLogs
);

adminRoutes.get(
  "/cref/requests",
  validate(adminCrefQueueQuerySchema),
  adminController.listCrefValidationQueue
);

adminRoutes.patch(
  "/cref/requests/:providerId",
  writeRateLimiter,
  validate(reviewProviderCrefSchema),
  adminController.reviewProviderCref
);

adminRoutes.get(
  "/support/tickets",
  validate(adminSupportQueueQuerySchema),
  adminController.listSupportTickets
);
adminRoutes.get(
  "/support/tickets/:ticketId",
  validate(adminSupportTicketDetailSchema),
  adminController.getSupportTicketDetail
);

adminRoutes.patch(
  "/support/tickets/:ticketId/respond",
  writeRateLimiter,
  validate(adminSupportReplySchema),
  adminController.replySupportTicket
);

adminRoutes.get(
  "/data-retention/runs",
  validate(adminDataRetentionRunsQuerySchema),
  adminController.listDataRetentionRuns
);

adminRoutes.post(
  "/data-retention/run",
  writeRateLimiter,
  validate(adminRunDataRetentionSchema),
  adminController.runDataRetention
);

adminRoutes.get(
  "/chat-audit/sessions",
  validate(adminChatAuditSessionsQuerySchema),
  adminController.listChatAuditSessions
);

adminRoutes.get(
  "/chat-audit/sessions/:bookingId/messages",
  validate(adminChatAuditSessionMessagesSchema),
  adminController.getChatAuditSessionMessages
);

adminRoutes.get("/lookup/cref", validate(adminLookupCrefSchema), adminController.lookupCref);
adminRoutes.get("/lookup/chats", validate(adminLookupChatsSchema), adminController.lookupChats);
adminRoutes.get("/lookup/bookings", validate(adminLookupBookingsSchema), adminController.lookupBookings);
adminRoutes.get("/lookup/bookings/:bookingId", validate(adminLookupBookingDetailSchema), adminController.lookupBookingDetail);
adminRoutes.get(
  "/no-show-reports",
  validate(adminListNoShowReportsSchema),
  adminController.listNoShowReports
);

adminRoutes.post(
  "/users/:userId/suspend",
  writeRateLimiter,
  validate(adminSuspendUserSchema),
  adminController.suspendUser
);
adminRoutes.post(
  "/users/:userId/reactivate",
  writeRateLimiter,
  validate(adminReactivateUserSchema),
  adminController.reactivateUser
);
adminRoutes.patch(
  "/users/:userId/role",
  writeRateLimiter,
  validate(adminChangeUserRoleSchema),
  adminController.changeUserRole
);
adminRoutes.post(
  "/users/:userId/legal-hold",
  writeRateLimiter,
  validate(adminSetLegalHoldSchema),
  adminController.setLegalHold
);
adminRoutes.delete(
  "/users/:userId/legal-hold",
  writeRateLimiter,
  validate(adminClearLegalHoldSchema),
  adminController.clearLegalHold
);
adminRoutes.post(
  "/users/:userId/export-data",
  writeRateLimiter,
  validate(adminExportUserDataSchema),
  adminController.exportUserData
);

adminRoutes.get(
  "/users/search",
  validate(adminSearchUsersSchema),
  adminController.searchUsers
);
adminRoutes.get(
  "/users/:userId",
  validate(adminUserDetailSchema),
  adminController.getUserDetail
);

adminRoutes.get(
  "/debts",
  validate(adminListDebtsQuerySchema),
  adminController.listDebts
);
adminRoutes.post(
  "/debts/:debtId/write-off",
  writeRateLimiter,
  validate(adminWriteOffDebtSchema),
  adminController.writeOffDebt
);

adminRoutes.get(
  "/disputes",
  validate(adminListDisputeCasesQuerySchema),
  adminController.listDisputeCases
);
adminRoutes.get(
  "/disputes/:caseId",
  validate(adminDisputeCaseIdSchema),
  adminController.getDisputeCaseDetail
);
adminRoutes.post(
  "/disputes/:caseId/resolve",
  writeRateLimiter,
  validate(adminResolveDisputeCaseSchema),
  adminController.resolveDisputeCase
);

// Épico de Frentes, Frente 10, Lote 1: fila unificada de moderação de
// denúncias (post, chat de agendamento, chat de consultoria) - antes não
// existia nenhum endpoint que lesse essas 3 tabelas.
adminRoutes.get("/reports", validate(adminListReportsSchema), adminController.listReports);
adminRoutes.patch(
  "/reports/:type/:id/dismiss",
  writeRateLimiter,
  validate(adminReportActionSchema),
  adminController.dismissReport
);
adminRoutes.patch(
  "/reports/:type/:id/hide-content",
  writeRateLimiter,
  validate(adminReportActionSchema),
  adminController.hideReportedContent
);

adminRoutes.get("/exercises", validate(listExercisesSchema), adminController.listPrebuiltExercises.bind(adminController));
adminRoutes.post("/exercises", writeRateLimiter, validate(createPrebuiltExerciseSchema), adminController.createPrebuiltExercise.bind(adminController));
adminRoutes.patch("/exercises/:exerciseId", writeRateLimiter, validate(updatePrebuiltExerciseSchema), adminController.updatePrebuiltExercise.bind(adminController));
adminRoutes.delete("/exercises/:exerciseId", writeRateLimiter, validate(exerciseIdSchema), adminController.deletePrebuiltExercise.bind(adminController));
