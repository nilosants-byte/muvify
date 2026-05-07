import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { UserController } from "../controllers/user.controller";
import {
  changeMyPasswordSchema,
  recordConsentSchema,
  sendSupportMessageSchema,
  userPhotoParamsSchema,
  updateMeSchema,
  upsertNotificationPreferencesSchema,
  upsertRecoveryEmailSchema,
  upsertMyAnamnesisSchema,
  upsertProviderBankAccountSchema
} from "../validators/user.validator";

const userController = new UserController();
export const userRoutes = Router();

userRoutes.get(
  "/:userId/photo",
  validate(userPhotoParamsSchema),
  userController.streamPhoto
);

userRoutes.use(ensureAuthenticated);

userRoutes.get("/me", userController.me);
userRoutes.patch("/me", uploadRateLimiter, validate(updateMeSchema), userController.updateMe);
userRoutes.get(
  "/me/anamnesis",
  ensureRole(UserRole.CLIENT),
  userController.getMyAnamnesis
);
userRoutes.put(
  "/me/anamnesis",
  ensureRole(UserRole.CLIENT),
  validate(upsertMyAnamnesisSchema),
  userController.upsertMyAnamnesis
);
userRoutes.get(
  "/me/provider-bank-account",
  ensureRole(UserRole.PROVIDER),
  userController.getProviderBankAccount
);
userRoutes.put(
  "/me/provider-bank-account",
  ensureRole(UserRole.PROVIDER),
  validate(upsertProviderBankAccountSchema),
  userController.upsertProviderBankAccount
);
userRoutes.post(
  "/me/security/password",
  validate(changeMyPasswordSchema),
  userController.changeMyPassword
);
userRoutes.get("/me/security/recovery-email", userController.getRecoveryEmail);
userRoutes.put(
  "/me/security/recovery-email",
  validate(upsertRecoveryEmailSchema),
  userController.upsertRecoveryEmail
);
userRoutes.post(
  "/me/support-message",
  validate(sendSupportMessageSchema),
  userController.sendSupportMessage
);

userRoutes.delete("/me", userController.deleteMe);
userRoutes.get("/me/data-export", userController.exportMyData);
userRoutes.post("/me/consent", validate(recordConsentSchema), userController.recordConsent);
userRoutes.get("/me/notifications/preferences", userController.getNotificationPreferences);
userRoutes.put(
  "/me/notifications/preferences",
  validate(upsertNotificationPreferencesSchema),
  userController.upsertNotificationPreferences
);
