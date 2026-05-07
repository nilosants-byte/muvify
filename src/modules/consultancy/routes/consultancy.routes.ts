import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { ConsultancyController } from "../controllers/consultancy.controller";
import {
  archivedConsultancyQuerySchema,
  completeTrainingPlanSchema,
  createConsultancyRequestSchema,
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

consultancyRoutes.get("/my/training", consultancyController.myTraining);
consultancyRoutes.get("/my/training/completions", consultancyController.myTrainingCompletions);
consultancyRoutes.post(
  "/my/training/plans/:trainingPlanId/complete",
  validate(completeTrainingPlanSchema),
  consultancyController.completeTrainingPlan
);
consultancyRoutes.get("/my/requests", consultancyController.listMyRequests);
consultancyRoutes.get(
  "/my/requests/archived",
  validate(archivedConsultancyQuerySchema),
  consultancyController.listMyArchivedRequests
);
consultancyRoutes.post(
  "/requests",
  validate(createConsultancyRequestSchema),
  consultancyController.createRequest
);
consultancyRoutes.post(
  "/requests/:requestId/decision",
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
  validate(createProviderOfferSchema),
  consultancyController.createProviderOffer
);
consultancyRoutes.patch(
  "/provider/offers/:offerId",
  ensureRole(UserRole.PROVIDER),
  validate(updateProviderOfferSchema),
  consultancyController.updateProviderOffer
);
consultancyRoutes.delete(
  "/provider/offers/:offerId",
  ensureRole(UserRole.PROVIDER),
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
  validate(createTrainingPlanSchema),
  consultancyController.createTrainingPlan
);
consultancyRoutes.patch(
  "/provider/plans/:planId",
  ensureRole(UserRole.PROVIDER),
  validate(updateTrainingPlanSchema),
  consultancyController.updateTrainingPlan
);
consultancyRoutes.delete(
  "/provider/plans/:planId",
  ensureRole(UserRole.PROVIDER),
  validate(trainingPlanIdSchema),
  consultancyController.deleteTrainingPlan
);
consultancyRoutes.post(
  "/requests/:requestId/respond",
  ensureRole(UserRole.PROVIDER),
  validate(respondConsultancyRequestSchema),
  consultancyController.respondRequest
);
consultancyRoutes.post(
  "/contracts/:contractId/deliver",
  ensureRole(UserRole.PROVIDER),
  validate(deliverContractSchema),
  consultancyController.deliverContract
);
