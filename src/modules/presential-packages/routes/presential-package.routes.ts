import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { PresentialPackageController } from "../controllers/presential-package.controller";
import {
  packageIdParamSchema,
  purchasePresentialPackageSchema
} from "../validators/presential-package.validator";

const presentialPackageController = new PresentialPackageController();

export const presentialPackageRoutes = Router();

presentialPackageRoutes.use(ensureAuthenticated);

// Frente 9 (segunda camada), Lote 1: único módulo de dinheiro/contrato do
// sistema sem nenhum rate limiter dedicado - compra, combo e cancelamento
// chamam a API do Mercado Pago de verdade (cobrança/estorno) e ficavam
// protegidos só pelo limite genérico global da API. Booking e consultoria
// já usam uploadRateLimiter em toda escrita sensível equivalente.
presentialPackageRoutes.post(
  "/",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(purchasePresentialPackageSchema),
  presentialPackageController.purchase
);
presentialPackageRoutes.post(
  "/combo",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(purchasePresentialPackageSchema),
  presentialPackageController.purchaseCombo
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
  uploadRateLimiter,
  validate(packageIdParamSchema),
  presentialPackageController.cancel
);
