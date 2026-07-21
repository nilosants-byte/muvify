import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { PresentialPackageController } from "../controllers/presential-package.controller";
import {
  packageIdParamSchema,
  purchasePresentialPackageSchema
} from "../validators/presential-package.validator";

const presentialPackageController = new PresentialPackageController();

export const presentialPackageRoutes = Router();

presentialPackageRoutes.use(ensureAuthenticated);

presentialPackageRoutes.post(
  "/",
  ensureRole(UserRole.CLIENT),
  validate(purchasePresentialPackageSchema),
  presentialPackageController.purchase
);
presentialPackageRoutes.get("/my", ensureRole(UserRole.CLIENT), presentialPackageController.listMine);
presentialPackageRoutes.get(
  "/provider/my",
  ensureRole(UserRole.PROVIDER),
  presentialPackageController.listAsProvider
);
presentialPackageRoutes.get(
  "/:packageId",
  validate(packageIdParamSchema),
  presentialPackageController.getById
);
presentialPackageRoutes.post(
  "/:packageId/cancel",
  validate(packageIdParamSchema),
  presentialPackageController.cancel
);
