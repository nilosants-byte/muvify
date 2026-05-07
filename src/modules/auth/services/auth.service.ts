import { Prisma, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { connectRedis, redis } from "../../../config/redis";
import { AppError } from "../../../shared/errors/app-error";
import { EmailService } from "../../../shared/services/email.service";
import { isAdminEmail, resolveEffectiveUserRole } from "../../../shared/utils/admin-access";
import { compareHash, hashValue } from "../../../shared/utils/hash";
import { signToken } from "../../../shared/utils/jwt";
import { toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { generateRefreshToken, hashRefreshToken } from "../../../shared/utils/refresh-token";

type RegisterInput = {
  name: string;
  email: string;
  password: string;
  phone: string;
  role?: "CLIENT" | "PROVIDER";
  termsVersion: string;
  consentAccepted: true;
};

type ResetPasswordInput = {
  token: string;
  newPassword: string;
};

type ForgotPasswordInput = {
  channel: "EMAIL";
  email?: string;
};

type PrismaLike = Prisma.TransactionClient | typeof prisma;

function parseDurationToSeconds(duration: string): number {
  const m = /^(\d+)([smhd]?)$/.exec(duration.trim());
  if (!m) return 900;
  const n = parseInt(m[1]);
  switch (m[2]) {
    case "h": return n * 3600;
    case "d": return n * 86400;
    case "m": return n * 60;
    default:  return n;
  }
}

function shouldExposeResetToken() {
  if (env.NODE_ENV === "test") {
    return true;
  }
  return env.NODE_ENV !== "production" && env.PASSWORD_RESET_TOKEN_EXPOSE_IN_DEV;
}

export class AuthService {
  private emailService = new EmailService();

  private loginAttemptsKey(email: string) {
    return `auth:login:attempts:${email}`;
  }

  private async ensureLoginNotLocked(email: string) {
    if (env.NODE_ENV === "test") {
      return;
    }
    await connectRedis();
    if (redis.status !== "ready") {
      return;
    }
    const attempts = await redis.get(this.loginAttemptsKey(email));
    if (attempts && Number(attempts) >= env.LOGIN_MAX_ATTEMPTS) {
      throw new AppError(
        "Muitas tentativas. Tente novamente mais tarde.",
        StatusCodes.TOO_MANY_REQUESTS
      );
    }
  }

  private async registerLoginFailure(email: string) {
    if (env.NODE_ENV === "test") {
      return 0;
    }
    await connectRedis();
    if (redis.status !== "ready") {
      return 0;
    }
    const key = this.loginAttemptsKey(email);
    const attempts = await redis.incr(key);
    if (attempts === 1) {
      await redis.expire(key, env.LOGIN_LOCK_MINUTES * 60);
    }
    return attempts;
  }

  private async clearLoginAttempts(email: string) {
    if (env.NODE_ENV === "test") {
      return;
    }
    await connectRedis();
    if (redis.status !== "ready") {
      return;
    }
    await redis.del(this.loginAttemptsKey(email));
  }

  private async createSession(userId: string, tx: PrismaLike = prisma) {
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(
      Date.now() + env.REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
    );
    await tx.session.create({
      data: {
        userId,
        refreshTokenHash,
        expiresAt
      }
    });
    return refreshToken;
  }

  private async createEmailVerificationToken(userId: string) {
    const token = generateRefreshToken();
    const tokenHash = hashRefreshToken(token);
    const expiresAt = new Date(
      Date.now() + env.EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS * 60 * 60 * 1000
    );

    await prisma.emailVerificationToken.deleteMany({
      where: { userId, usedAt: null }
    });

    await prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt }
    });

    return token;
  }

  async register({
    name,
    email,
    password,
    phone,
    role,
    termsVersion,
    consentAccepted
  }: RegisterInput) {
    const normalizedEmail = email.trim().toLowerCase();
    if (consentAccepted !== true) {
      throw new AppError("Aceite dos termos é obrigatório para criar conta.", StatusCodes.BAD_REQUEST);
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new AppError("E-mail ja cadastrado.", StatusCodes.CONFLICT);
    }

    const persistedRole = isAdminEmail(normalizedEmail)
      ? UserRole.ADMIN
      : (role as UserRole | undefined) ?? UserRole.CLIENT;

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        phone,
        password: await hashValue(password),
        role: persistedRole,
        termsAcceptedAt: new Date(),
        privacyPolicyAcceptedAt: new Date(),
        termsVersion: termsVersion.trim()
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        photoUrl: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const effectiveRole = resolveEffectiveUserRole(user.email, user.role);
    const refreshToken = await this.createSession(user.id);

    if (this.emailService.canSendEmail()) {
      try {
        const verificationToken = await this.createEmailVerificationToken(user.id);
        const verificationUrl = `${env.EMAIL_VERIFICATION_WEB_URL}?token=${encodeURIComponent(verificationToken)}`;
        await this.emailService.sendEmailVerificationEmail({
          to: user.email,
          name: user.name,
          verificationUrl
        });
      } catch {
        // best effort — registration succeeds even if verification email fails
      }
    }

    return {
      user: {
        ...user,
        photoUrl: toUserPhotoUrl(user.id, user.photoUrl, user.updatedAt),
        role: effectiveRole
      },
      accessToken: signToken(user.id, effectiveRole),
      refreshToken
    };
  }

  async verifyEmail(token: string) {
    const tokenHash = hashRefreshToken(token);
    const now = new Date();

    const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt <= now) {
      throw new AppError("Link de verificacao invalido ou expirado.", StatusCodes.BAD_REQUEST);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: now }
      }),
      prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: now }
      })
    ]);
  }

  async resendVerificationEmail(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerifiedAt: true }
    });

    if (!user) {
      throw new AppError("Usuario nao encontrado.", StatusCodes.NOT_FOUND);
    }

    if (user.emailVerifiedAt) {
      throw new AppError("E-mail ja verificado.", StatusCodes.CONFLICT);
    }

    if (!this.emailService.canSendEmail()) {
      throw new AppError(
        "Servico de e-mail nao configurado. Tente novamente mais tarde.",
        StatusCodes.SERVICE_UNAVAILABLE
      );
    }

    const verificationToken = await this.createEmailVerificationToken(user.id);
    const verificationUrl = `${env.EMAIL_VERIFICATION_WEB_URL}?token=${encodeURIComponent(verificationToken)}`;
    await this.emailService.sendEmailVerificationEmail({
      to: user.email,
      name: user.name,
      verificationUrl
    });
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    await this.ensureLoginNotLocked(normalizedEmail);
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const validPassword = user ? await compareHash(password, user.password) : false;
    if (!user || !validPassword) {
      const attempts = await this.registerLoginFailure(normalizedEmail);
      if (attempts >= env.LOGIN_MAX_ATTEMPTS && attempts > 0) {
        throw new AppError(
          "Muitas tentativas. Tente novamente mais tarde.",
          StatusCodes.TOO_MANY_REQUESTS
        );
      }
      throw new AppError("Credenciais invalidas.", StatusCodes.UNAUTHORIZED);
    }

    await this.clearLoginAttempts(normalizedEmail);
    const effectiveRole = resolveEffectiveUserRole(user.email, user.role);
    const refreshToken = await this.createSession(user.id);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: effectiveRole,
        phone: user.phone,
        photoUrl: toUserPhotoUrl(user.id, user.photoUrl, user.updatedAt)
      },
      accessToken: signToken(user.id, effectiveRole),
      refreshToken
    };
  }

  async refresh(refreshToken: string) {
    const refreshTokenHash = hashRefreshToken(refreshToken);
    return prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { refreshTokenHash },
        include: { user: true }
      });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        throw new AppError("Refresh token invalido.", StatusCodes.UNAUTHORIZED);
      }

      const newRefreshToken = await this.createSession(session.userId, tx);
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() }
      });

      const effectiveRole = resolveEffectiveUserRole(session.user.email, session.user.role);
      return {
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          role: effectiveRole,
          phone: session.user.phone,
          photoUrl: toUserPhotoUrl(
            session.user.id,
            session.user.photoUrl,
            session.user.updatedAt
          )
        },
        accessToken: signToken(session.user.id, effectiveRole),
        refreshToken: newRefreshToken
      };
    });
  }

  async logout(refreshToken: string) {
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const session = await prisma.session.findFirst({
      where: { refreshTokenHash, revokedAt: null },
      select: { userId: true }
    });
    await prisma.session.updateMany({
      where: { refreshTokenHash, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (session && redis.status === "ready") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ttl = parseDurationToSeconds(env.ACCESS_TOKEN_EXPIRES_IN);
      await redis.set(`auth:blacklist:${session.userId}`, String(nowSeconds), "EX", ttl);
    }
  }

  async forgotPassword(input: ForgotPasswordInput) {
    const channel = input.channel ?? "EMAIL";
    const normalizedEmail = input.email?.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail
      }
    });

    if (!user) {
      return {
        message:
          "Se o e-mail existir, enviaremos instrucoes para redefinir a senha."
      };
    }

    const resetToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(resetToken);
    const expiresAt = new Date(
      Date.now() + env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES * 60 * 1000
    );

    await prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null
      }
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    });

    if (channel === "EMAIL" && this.emailService.canSendEmail()) {
      try {
        await this.emailService.sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetToken
        });
      } catch (error) {
        // best effort: never expose SMTP failures to forgot-password callers
        const reason = error instanceof Error ? error.message : "unknown";
        console.warn(`[AUTH_FORGOT_PASSWORD_EMAIL_FAILED] userId=${user.id} reason=${reason}`);
      }
    }

    const response: { message: string; resetToken?: string } = {
      message: "Se o e-mail existir, enviaremos instrucoes para redefinir a senha."
    };

    if (shouldExposeResetToken()) {
      response.resetToken = resetToken;
    }

    return response;
  }

  async resetPassword({ token, newPassword }: ResetPasswordInput) {
    const tokenHash = hashRefreshToken(token);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const passwordResetToken = await tx.passwordResetToken.findUnique({
        where: { tokenHash }
      });

      if (!passwordResetToken || passwordResetToken.usedAt || passwordResetToken.expiresAt <= now) {
        throw new AppError("Token de recuperacao invalido ou expirado.", StatusCodes.BAD_REQUEST);
      }

      await tx.user.update({
        where: { id: passwordResetToken.userId },
        data: {
          password: await hashValue(newPassword)
        }
      });

      await tx.passwordResetToken.update({
        where: { id: passwordResetToken.id },
        data: { usedAt: now }
      });

      await tx.session.updateMany({
        where: {
          userId: passwordResetToken.userId,
          revokedAt: null
        },
        data: { revokedAt: now }
      });
    });
  }
}
