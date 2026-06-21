import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { AdminController } from "../controllers/admin.controller";
import {
  adminChatAuditSessionMessagesSchema,
  adminChatAuditSessionsQuerySchema,
  adminCrefQueueQuerySchema,
  adminDataRetentionRunsQuerySchema,
  adminDashboardOverviewSchema,
  adminLookupBookingDetailSchema,
  adminLookupBookingsSchema,
  adminLookupChatsSchema,
  adminLookupCrefSchema,
  adminRunDataRetentionSchema,
  adminSupportQueueQuerySchema,
  adminSupportReplySchema,
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

adminRoutes.get(
  "/cref/requests",
  validate(adminCrefQueueQuerySchema),
  adminController.listCrefValidationQueue
);

adminRoutes.patch(
  "/cref/requests/:providerId",
  uploadRateLimiter,
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
  uploadRateLimiter,
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
  uploadRateLimiter,
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

adminRoutes.get("/exercises", validate(listExercisesSchema), adminController.listPrebuiltExercises.bind(adminController));
adminRoutes.post("/exercises", uploadRateLimiter, validate(createPrebuiltExerciseSchema), adminController.createPrebuiltExercise.bind(adminController));
adminRoutes.patch("/exercises/:exerciseId", uploadRateLimiter, validate(updatePrebuiltExerciseSchema), adminController.updatePrebuiltExercise.bind(adminController));
adminRoutes.delete("/exercises/:exerciseId", uploadRateLimiter, validate(exerciseIdSchema), adminController.deletePrebuiltExercise.bind(adminController));
