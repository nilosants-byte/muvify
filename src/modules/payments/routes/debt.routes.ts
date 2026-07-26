import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { DebtController } from "../controllers/debt.controller";
import { payDebtSchema } from "../validators/debt.validator";

const debtController = new DebtController();

export const debtRoutes = Router();

debtRoutes.use(ensureAuthenticated);

debtRoutes.get("/my", ensureRole(UserRole.CLIENT), debtController.listMyDebts);
debtRoutes.post(
  "/:debtId/pay",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(payDebtSchema),
  debtController.payDebt
);
debtRoutes.get("/provider/my", ensureRole(UserRole.PROVIDER), debtController.listProviderDebts);
