import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { uploadRateLimiter, writeRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { UserController } from "../controllers/user.controller";
import {
  changeMyPasswordSchema,
  deleteMeSchema,
  recordConsentSchema,
  sendSupportMessageSchema,
  switchOrAddOfferSchema,
  userPhotoParamsSchema,
  updateMeSchema,
  upsertNotificationPreferencesSchema,
  upsertRecoveryEmailSchema,
  upsertMyAnamnesisSchema
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
// Bloco 3 (exclusividade de marketplace): resumo do vínculo ativo do
// cliente (profissional + tipo + valor + sessões) — alimenta o gate de
// Home/navegação e o card de plano da aba "Meu Personal" no app.
userRoutes.get(
  "/me/active-engagement",
  ensureRole(UserRole.CLIENT),
  userController.myActiveEngagement
);
userRoutes.post(
  "/me/active-engagement/switch",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(switchOrAddOfferSchema),
  userController.switchOrAddOffer
);
userRoutes.patch("/me", uploadRateLimiter, validate(updateMeSchema), userController.updateMe);
userRoutes.get(
  "/me/anamnesis",
  ensureRole(UserRole.CLIENT),
  userController.getMyAnamnesis
);
userRoutes.put(
  "/me/anamnesis",
  ensureRole(UserRole.CLIENT),
  uploadRateLimiter,
  validate(upsertMyAnamnesisSchema),
  userController.upsertMyAnamnesis
);
userRoutes.post(
  "/me/security/password",
  uploadRateLimiter,
  validate(changeMyPasswordSchema),
  userController.changeMyPassword
);
userRoutes.get("/me/security/recovery-email", userController.getRecoveryEmail);
userRoutes.put(
  "/me/security/recovery-email",
  uploadRateLimiter,
  validate(upsertRecoveryEmailSchema),
  userController.upsertRecoveryEmail
);
userRoutes.get("/me/security/sessions", userController.listMySessions);
userRoutes.delete(
  "/me/security/sessions/:sessionId",
  writeRateLimiter,
  userController.revokeMySession
);
userRoutes.post(
  "/me/support-message",
  uploadRateLimiter,
  validate(sendSupportMessageSchema),
  userController.sendSupportMessage
);
// Épico de Frentes, Frente 10, Lote 2: usuário não tinha como ler a
// resposta do suporte dentro do app - só push (truncado)/e-mail.
userRoutes.get("/me/support-tickets", userController.listMySupportTickets);

userRoutes.delete("/me", uploadRateLimiter, validate(deleteMeSchema), userController.deleteMe);
userRoutes.get("/me/data-export", uploadRateLimiter, userController.exportMyData);
userRoutes.get("/me/disputes", userController.myDisputes);
// Épico de Frentes, Frente 11, Lote 2: único endpoint autenticado do
// módulo sem rate limiter nenhum.
userRoutes.post("/me/consent", writeRateLimiter, validate(recordConsentSchema), userController.recordConsent);
userRoutes.get("/me/notifications/preferences", userController.getNotificationPreferences);
userRoutes.put(
  "/me/notifications/preferences",
  uploadRateLimiter,
  validate(upsertNotificationPreferencesSchema),
  userController.upsertNotificationPreferences
);
