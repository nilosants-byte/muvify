import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
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
  updateCustomerCardSchema
} from "../validators/payment.validator";

const paymentController = new PaymentController();

export const paymentRoutes = Router();

paymentRoutes.post("/webhook", paymentController.webhook);

paymentRoutes.use(ensureAuthenticated);
paymentRoutes.get("/customer", paymentController.customerStatus);
paymentRoutes.post(
  "/customer/setup-intent",
  validate(createCustomerSetupIntentSchema),
  paymentController.createCustomerSetupIntent
);
paymentRoutes.post(
  "/customer/setup-intent/confirm",
  validate(confirmCustomerSetupIntentSchema),
  paymentController.confirmCustomerSetupIntent
);
paymentRoutes.post(
  "/customer/setup",
  validate(setupCustomerPaymentSchema),
  paymentController.setupCustomer
);
paymentRoutes.get("/customer/cards", paymentController.listCustomerCards);
paymentRoutes.patch(
  "/customer/cards/:cardId",
  validate(updateCustomerCardSchema),
  paymentController.updateCustomerCardNickname
);
paymentRoutes.patch(
  "/customer/cards/:cardId/default",
  validate(customerCardIdParamSchema),
  paymentController.setCustomerCardDefault
);
paymentRoutes.delete(
  "/customer/cards/:cardId",
  validate(customerCardIdParamSchema),
  paymentController.removeCustomerCard
);
paymentRoutes.post(
  "/provider/account",
  validate(createProviderAccountSchema),
  paymentController.createProviderAccount
);
paymentRoutes.post(
  "/provider/account/onboarding-link",
  validate(createProviderAccountSchema),
  paymentController.createProviderOnboardingLink
);
paymentRoutes.get("/provider/account", paymentController.providerStatus);
paymentRoutes.get(
  "/booking/:bookingId",
  validate(bookingPaymentSchema),
  paymentController.showBookingPayment
);
paymentRoutes.post(
  "/booking/:bookingId/pix/charge",
  validate(createPixChargeSchema),
  paymentController.createBookingPixCharge
);
paymentRoutes.patch(
  "/booking/:bookingId/method",
  validate(selectBookingPaymentMethodSchema),
  paymentController.selectBookingPaymentMethod
);
