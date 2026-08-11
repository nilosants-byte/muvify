import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { authRateLimiter, refreshRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { AuthController } from "../controllers/auth.controller";
import { TwoFactorController } from "../controllers/two-factor.controller";
import {
  confirmEmailVerificationSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema
} from "../validators/auth.validator";
import {
  confirmTwoFactorSchema,
  disableTwoFactorSchema,
  loginWithTwoFactorSchema
} from "../validators/two-factor.validator";
const authController = new AuthController();
const twoFactorController = new TwoFactorController();
export const authRoutes = Router();
/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Cadastro de usuario
 *     tags: [Auth]
 */
authRoutes.post("/register", authRateLimiter, validate(registerSchema), authController.register);
authRoutes.post("/login", authRateLimiter, validate(loginSchema), authController.login);
/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Renova o access token
 *     tags: [Auth]
 */
authRoutes.post("/refresh", refreshRateLimiter, validate(refreshSchema), authController.refresh);
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Revoga o refresh token
 *     tags: [Auth]
 */
authRoutes.post("/logout", authRateLimiter, validate(refreshSchema), authController.logout);
/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Solicita token de recuperacao de senha
 *     tags: [Auth]
 */
authRoutes.post(
  "/forgot-password",
  authRateLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);
/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Redefine a senha a partir de token de recuperacao
 *     tags: [Auth]
 */
authRoutes.post(
  "/reset-password",
  authRateLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);
/**
 * @swagger
 * /auth/verify-email:
 *   get:
 *     summary: Verifica o e-mail do usuario a partir do link enviado por e-mail
 *     tags: [Auth]
 */
authRoutes.get("/verify-email", authRateLimiter, authController.verifyEmail);
/**
 * @swagger
 * /auth/verify-email:
 *   post:
 *     summary: Confirma a verificacao do e-mail (consome o token de verdade, disparado por clique real do usuario)
 *     tags: [Auth]
 */
authRoutes.post(
  "/verify-email",
  authRateLimiter,
  validate(confirmEmailVerificationSchema),
  authController.confirmVerifyEmail
);
/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Reenvia o e-mail de verificacao para o usuario autenticado
 *     tags: [Auth]
 */
authRoutes.post(
  "/resend-verification",
  authRateLimiter,
  ensureAuthenticated,
  authController.resendVerificationEmail
);

// 2FA — verificação no login (não requer sessão, usa challengeToken)
authRoutes.post(
  "/2fa/verify",
  authRateLimiter,
  validate(loginWithTwoFactorSchema),
  twoFactorController.loginWithTwoFactor
);

// 2FA — gerenciamento (requer sessão ativa)
authRoutes.post(
  "/2fa/setup",
  authRateLimiter,
  ensureAuthenticated,
  twoFactorController.setup
);
authRoutes.post(
  "/2fa/confirm",
  authRateLimiter,
  ensureAuthenticated,
  validate(confirmTwoFactorSchema),
  twoFactorController.confirm
);
authRoutes.delete(
  "/2fa",
  authRateLimiter,
  ensureAuthenticated,
  validate(disableTwoFactorSchema),
  twoFactorController.disable
);
