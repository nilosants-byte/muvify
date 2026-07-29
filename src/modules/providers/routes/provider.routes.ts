import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { uploadRateLimiter, apiRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ProviderController } from "../controllers/provider.controller";
import {
  createProviderManualCalendarEventSchema,
  createProviderProfileSchema,
  providerCalendarEventIdSchema,
  providerDashboardCalendarQuerySchema,
  providerSchedulePreviewSchema,
  upsertProviderCredentialsSchema,
  providerIdSchema,
  providerStudentDetailSchema,
  searchProvidersSchema,
  upsertProviderStudentPhysicalAssessmentSchema,
  updateProviderManualCalendarEventSchema,
  updateProviderProfileSchema
} from "../validators/provider.validator";

const providerController = new ProviderController();
export const providerRoutes = Router();

providerRoutes.get("/", validate(searchProvidersSchema), providerController.search);

providerRoutes.get(
  "/me/credentials",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  providerController.getOwnCredentials
);

providerRoutes.put(
  "/me/credentials",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(upsertProviderCredentialsSchema),
  providerController.upsertOwnCredentials
);

providerRoutes.patch(
  "/:providerId/credentials/validate",
  ensureAuthenticated,
  ensureRole(UserRole.ADMIN),
  validate(providerIdSchema),
  providerController.validateProviderCredentials
);

providerRoutes.get(
  "/dashboard/calendar",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  validate(providerDashboardCalendarQuerySchema),
  providerController.dashboardCalendar
);

providerRoutes.post(
  "/dashboard/calendar/manual",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(createProviderManualCalendarEventSchema),
  providerController.createManualCalendarEvent
);

providerRoutes.patch(
  "/dashboard/calendar/manual/:eventId",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(updateProviderManualCalendarEventSchema),
  providerController.updateManualCalendarEvent
);

providerRoutes.delete(
  "/dashboard/calendar/manual/:eventId",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(providerCalendarEventIdSchema),
  providerController.deleteManualCalendarEvent
);

providerRoutes.get(
  "/dashboard/students",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  providerController.dashboardStudents
);

providerRoutes.get(
  "/dashboard/students/:clientId",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  validate(providerStudentDetailSchema),
  providerController.dashboardStudentDetail
);

providerRoutes.put(
  "/dashboard/students/:clientId/physical-assessment",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(upsertProviderStudentPhysicalAssessmentSchema),
  providerController.upsertStudentPhysicalAssessment
);

providerRoutes.get(
  "/dashboard/students/:clientId/anamnesis",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  validate(providerStudentDetailSchema),
  providerController.getStudentAnamnesis
);

providerRoutes.get(
  "/me/timeline",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  providerController.getTimeline
);

providerRoutes.post(
  "/profile",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(createProviderProfileSchema),
  providerController.createProfile
);

providerRoutes.put(
  "/profile",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(updateProviderProfileSchema),
  providerController.updateProfile
);

providerRoutes.get(
  "/:providerId/schedule-preview",
  apiRateLimiter,
  validate(providerSchedulePreviewSchema),
  providerController.schedulePreview
);

providerRoutes.get(
  "/:providerId/photo",
  validate(providerIdSchema),
  providerController.streamPhoto
);

providerRoutes.get(
  "/:providerId/video",
  validate(providerIdSchema),
  providerController.streamVideo
);

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: rota assinada (não
// autenticada por sessão, igual /photo e /video) que serve o documento de
// CREF privado — a validação real acontece via HMAC em getSignedCredentialDocument.
providerRoutes.get(
  "/:providerId/credentials/documents/:key",
  providerController.streamCredentialDocument
);

providerRoutes.get("/:providerId", validate(providerIdSchema), providerController.show);
