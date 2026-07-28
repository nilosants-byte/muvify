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
// Raio-X de pagamentos, Rodada 4, Lote 6: profissional também pode regularizar
// a própria pendência ativamente agora — o service já valida que a dívida
// pertence de fato a quem está chamando (cliente ou profissional).
debtRoutes.post(
  "/:debtId/pay",
  ensureRole(UserRole.CLIENT, UserRole.PROVIDER),
  uploadRateLimiter,
  validate(payDebtSchema),
  debtController.payDebt
);
debtRoutes.get("/provider/my", ensureRole(UserRole.PROVIDER), debtController.listProviderDebts);
