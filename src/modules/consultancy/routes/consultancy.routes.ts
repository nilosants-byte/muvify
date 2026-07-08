import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { ConsultancyController } from "../controllers/consultancy.controller";
import {
  archivedConsultancyQuerySchema,
  completeTrainingPlanSchema,
  createConsultancyRequestSchema,
  offerIdParamSchema,
  createProviderOfferSchema,
  createTrainingPlanSchema,
  decideConsultancyRequestSchema,
  deliverContractSchema,
  providerCatalogSchema,
  respondConsultancyRequestSchema,
  trainingPlanIdSchema,
  updateTrainingPlanSchema,
  updateOnlineSettingSchema,
  updateProviderOfferSchema
} from "../validators/consultancy.validator";

const consultancyController = new ConsultancyController();

export const consultancyRoutes = Router();

consultancyRoutes.get("/promotions", consultancyController.promotions);
consultancyRoutes.get(
  "/providers/:providerId/catalog",
  validate(providerCatalogSchema),
  consultancyController.providerCatalog
);

consultancyRoutes.use(ensureAuthenticated);

consultancyRoutes.get("/my/training", ensureRole(UserRole.CLIENT), consultancyController.myTraining);
consultancyRoutes.get("/my/training/completions", ensureRole(UserRole.CLIENT), consultancyController.myTrainingCompletions);
consultancyRoutes.post(
  "/my/training/plans/:trainingPlanId/complete",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(completeTrainingPlanSchema),
  consultancyController.completeTrainingPlan
);
consultancyRoutes.get("/my/requests", ensureRole(UserRole.CLIENT), consultancyController.listMyRequests);
consultancyRoutes.get(
  "/my/requests/archived",
  ensureRole(UserRole.CLIENT),
  validate(archivedConsultancyQuerySchema),
  consultancyController.listMyArchivedRequests
);
consultancyRoutes.post(
  "/requests",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(createConsultancyRequestSchema),
  consultancyController.createRequest
);
consultancyRoutes.post(
  "/requests/:requestId/decision",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(decideConsultancyRequestSchema),
  consultancyController.decideRequest
);

consultancyRoutes.get(
  "/provider/requests",
  ensureRole(UserRole.PROVIDER),
  consultancyController.listProviderRequests
);
consultancyRoutes.get(
  "/provider/requests/archived",
  ensureRole(UserRole.PROVIDER),
  validate(archivedConsultancyQuerySchema),
  consultancyController.listProviderArchivedRequests
);
consultancyRoutes.put(
  "/provider/settings",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(updateOnlineSettingSchema),
  consultancyController.upsertOnlineSetting
);
consultancyRoutes.get(
  "/provider/settings",
  ensureRole(UserRole.PROVIDER),
  consultancyController.getOnlineSetting
);
consultancyRoutes.get(
  "/provider/offers",
  ensureRole(UserRole.PROVIDER),
  consultancyController.listProviderOffers
);
consultancyRoutes.post(
  "/provider/offers",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(createProviderOfferSchema),
  consultancyController.createProviderOffer
);
consultancyRoutes.patch(
  "/provider/offers/:offerId",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(updateProviderOfferSchema),
  consultancyController.updateProviderOffer
);
consultancyRoutes.delete(
  "/provider/offers/:offerId",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(offerIdParamSchema),
  consultancyController.deleteProviderOffer
);
consultancyRoutes.get(
  "/provider/plans",
  ensureRole(UserRole.PROVIDER),
  consultancyController.listProviderPlans
);
consultancyRoutes.post(
  "/provider/plans",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(createTrainingPlanSchema),
  consultancyController.createTrainingPlan
);
consultancyRoutes.patch(
  "/provider/plans/:planId",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(updateTrainingPlanSchema),
  consultancyController.updateTrainingPlan
);
consultancyRoutes.delete(
  "/provider/plans/:planId",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(trainingPlanIdSchema),
  consultancyController.deleteTrainingPlan
);
consultancyRoutes.post(
  "/requests/:requestId/respond",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(respondConsultancyRequestSchema),
  consultancyController.respondRequest
);
consultancyRoutes.post(
  "/contracts/:contractId/deliver",
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(deliverContractSchema),
  consultancyController.deliverContract
);
