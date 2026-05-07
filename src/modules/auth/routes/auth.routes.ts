import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { authRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { AuthController } from "../controllers/auth.controller";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema
} from "../validators/auth.validator";
const authController = new AuthController();
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
authRoutes.post("/refresh", authRateLimiter, validate(refreshSchema), authController.refresh);
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
