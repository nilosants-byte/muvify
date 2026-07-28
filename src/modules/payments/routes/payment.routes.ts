import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { PaymentController } from "../controllers/payment.controller";
import {
  bookingPaymentSchema,
  customerCardIdParamSchema,
  confirmCustomerSetupIntentSchema,
  createPixChargeSchema,
  createCustomerSetupIntentSchema,
  createProviderAccountSchema,
  selectBookingPaymentMethodSchema,
  setupCustomerPaymentSchema,
  updateCustomerCardSchema,
} from "../validators/payment.validator";

const paymentController = new PaymentController();

export const paymentRoutes = Router();

paymentRoutes.post("/webhook", paymentController.webhook);

paymentRoutes.use(ensureAuthenticated);

// Raio-X de pagamentos, Rodada 4, Lote 6: a rota de cartão do cliente
// (customer/*) era exclusiva de CLIENT, mas o profissional agora também
// pode pagar uma pendência ativamente (payDebt generalizado) — sem cartão
// cadastrado, essa opção nunca funcionaria de verdade. Abrir pra PROVIDER
// também não muda nada pro cliente; cada endpoint já opera só sobre o
// próprio usuário autenticado.
paymentRoutes.get("/customer", ensureRole(UserRole.CLIENT, UserRole.PROVIDER), paymentController.customerStatus);
paymentRoutes.post(
  "/customer/setup-intent",
  ensureRole(UserRole.CLIENT, UserRole.PROVIDER),
  validate(createCustomerSetupIntentSchema),
  paymentController.createCustomerSetupIntent
);
paymentRoutes.post(
  "/customer/setup-intent/confirm",
  ensureRole(UserRole.CLIENT, UserRole.PROVIDER),
  uploadRateLimiter,
  validate(confirmCustomerSetupIntentSchema),
  paymentController.confirmCustomerSetupIntent
);
paymentRoutes.post(
  "/customer/setup",
  ensureRole(UserRole.CLIENT, UserRole.PROVIDER),
  validate(setupCustomerPaymentSchema),
  paymentController.setupCustomer
);
paymentRoutes.get("/customer/cards", ensureRole(UserRole.CLIENT, UserRole.PROVIDER), paymentController.listCustomerCards);
paymentRoutes.patch(
  "/customer/cards/:cardId",
  ensureRole(UserRole.CLIENT, UserRole.PROVIDER),
  validate(updateCustomerCardSchema),
  paymentController.updateCustomerCardNickname
);
paymentRoutes.patch(
  "/customer/cards/:cardId/default",
  ensureRole(UserRole.CLIENT, UserRole.PROVIDER),
  validate(customerCardIdParamSchema),
  paymentController.setCustomerCardDefault
);
paymentRoutes.delete(
  "/customer/cards/:cardId",
  ensureRole(UserRole.CLIENT, UserRole.PROVIDER),
  validate(customerCardIdParamSchema),
  paymentController.removeCustomerCard
);
paymentRoutes.post(
  "/provider/account/onboarding-link",
  ensureRole(UserRole.PROVIDER),
  validate(createProviderAccountSchema),
  paymentController.createProviderOnboardingLink
);
paymentRoutes.get("/provider/account", ensureRole(UserRole.PROVIDER), paymentController.providerStatus);
paymentRoutes.get(
  "/booking/:bookingId",
  validate(bookingPaymentSchema),
  paymentController.showBookingPayment
);
paymentRoutes.post(
  "/booking/:bookingId/pix/charge",
  uploadRateLimiter,
  validate(createPixChargeSchema),
  paymentController.createBookingPixCharge
);
paymentRoutes.patch(
  "/booking/:bookingId/method",
  uploadRateLimiter,
  validate(selectBookingPaymentMethodSchema),
  paymentController.selectBookingPaymentMethod
);
