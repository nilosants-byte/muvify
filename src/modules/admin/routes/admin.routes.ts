import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { AdminController } from "../controllers/admin.controller";
import {
  adminChatAuditSessionMessagesSchema,
  adminChatAuditSessionsQuerySchema,
  adminCrefQueueQuerySchema,
  adminDataRetentionRunsQuerySchema,
  adminDashboardOverviewSchema,
  adminRunDataRetentionSchema,
  adminSupportQueueQuerySchema,
  adminSupportReplySchema,
  reviewProviderCrefSchema
} from "../validators/admin.validator";

const adminController = new AdminController();
export const adminRoutes = Router();

adminRoutes.use(ensureAuthenticated);
adminRoutes.use(ensureRole(UserRole.ADMIN));

adminRoutes.get(
  "/dashboard/overview",
  validate(adminDashboardOverviewSchema),
  adminController.dashboardOverview
);

adminRoutes.get(
  "/cref/requests",
  validate(adminCrefQueueQuerySchema),
  adminController.listCrefValidationQueue
);

adminRoutes.patch(
  "/cref/requests/:providerId",
  validate(reviewProviderCrefSchema),
  adminController.reviewProviderCref
);

adminRoutes.get(
  "/support/tickets",
  validate(adminSupportQueueQuerySchema),
  adminController.listSupportTickets
);

adminRoutes.patch(
  "/support/tickets/:ticketId/respond",
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
