import { Prisma, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { connectRedis, redis } from "../../../config/redis";
import { AppError } from "../../../shared/errors/app-error";
import {
  clearLocalLoginAttempts,
  getLocalLoginAttempts,
  incrementLocalLoginAttempts
} from "../../../shared/security/login-attempts";
import { setTokenBlacklist } from "../../../shared/security/token-blacklist";
import { EmailQueueService } from "../../../shared/services/email-queue.service";
import { EmailService } from "../../../shared/services/email.service";
import { isAdminEmail, resolveEffectiveUserRole } from "../../../shared/utils/admin-access";
import { decryptSensitiveText } from "../../../shared/utils/encryption";
import { TwoFactorService } from "./two-factor.service";
import { compareHash, hashValue } from "../../../shared/utils/hash";
import { signToken } from "../../../shared/utils/jwt";
import { toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { generateRefreshToken, hashRefreshToken } from "../../../shared/utils/refresh-token";

type RegisterInput = {
  name: string;
  apelido?: string;
  email: string;
  password: string;
  phone: string;
  role?: "CLIENT" | "PROVIDER";
  termsVersion: string;
  consentAccepted: true;
};

/** Gera um apelido único a partir do nome + prefixo do UUID. */
async function generateUniqueApelido(name: string, userId: string): Promise<string> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 23) || "user";
  const prefix = userId.replace(/-/g, "").slice(0, 6);
  let candidate = `${base}_${prefix}`;
  let suffix = 0;
  while (await prisma.user.findFirst({ where: { apelido: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}_${prefix}${suffix}`;
  }
  return candidate;
}

type ResetPasswordInput = {
  token: string;
  newPassword: string;
};

type ForgotPasswordInput = {
  channel: "EMAIL" | "RECOVERY_EMAIL";
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
  private emailQueueService = new EmailQueueService();
  private twoFactorService = new TwoFactorService();

  // Raio-X Muvify, Frente 2 (Segurança do código), Lote 2: quando o e-mail
  // não existe, bcrypt.compare nunca rodava — diferença de tempo entre
  // "e-mail não existe" e "senha errada" vazava existência de conta por
  // timing, mesmo com mensagem de erro idêntica. Hash dummy fixo, gerado
  // uma vez e cacheado, garante que o custo computacional do compare seja
  // sempre pago, nos dois ramos.
  private dummyPasswordHashPromise: Promise<string> | null = null;
  private getDummyPasswordHash() {
    if (!this.dummyPasswordHashPromise) {
      this.dummyPasswordHashPromise = hashValue("timing-safety-dummy-password-never-used");
    }
    return this.dummyPasswordHashPromise;
  }

  private loginAttemptsKey(email: string) {
    return `auth:login:attempts:${email}`;
  }

  private async ensureLoginNotLocked(email: string) {
    if (env.NODE_ENV === "test") {
      return;
    }
    await connectRedis();
    if (redis.status === "ready") {
      const attempts = await redis.get(this.loginAttemptsKey(email));
      if (attempts && Number(attempts) >= env.LOGIN_MAX_ATTEMPTS) {
        throw new AppError(
          "Muitas tentativas. Tente novamente mais tarde.",
          StatusCodes.TOO_MANY_REQUESTS
        );
      }
      return;
    }

    const localAttempts = getLocalLoginAttempts(email);
    if (localAttempts >= env.LOGIN_MAX_ATTEMPTS) {
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
    if (redis.status === "ready") {
      const key = this.loginAttemptsKey(email);
      const attempts = await redis.incr(key);
      if (attempts === 1) {
        await redis.expire(key, env.LOGIN_LOCK_MINUTES * 60);
      }
      return attempts;
    }
    return incrementLocalLoginAttempts(email, env.LOGIN_LOCK_MINUTES * 60);
  }

  private async clearLoginAttempts(email: string) {
    if (env.NODE_ENV === "test") {
      return;
    }
    await connectRedis();
    if (redis.status === "ready") {
      await redis.del(this.loginAttemptsKey(email));
      return;
    }
    clearLocalLoginAttempts(email);
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

  private async queueEmailVerificationEmail(input: {
    userId: string;
    email: string;
    name: string;
  }) {
    const verificationToken = await this.createEmailVerificationToken(input.userId);
    const verificationUrl =
      `${env.EMAIL_VERIFICATION_WEB_URL}?token=${encodeURIComponent(verificationToken)}`;
    await this.emailQueueService.enqueueEmailVerification({
      to: input.email,
      name: input.name,
      verificationUrl
    });
  }

  async register({
    name,
    apelido,
    email,
    password,
    phone,
    role,
    termsVersion,
    consentAccepted
  }: RegisterInput) {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.replace(/\D/g, "");
    if (consentAccepted !== true) {
      throw new AppError("Aceite dos termos e obrigatorio para criar conta.", StatusCodes.BAD_REQUEST);
    }
    if (!/^\d{8,15}$/.test(normalizedPhone)) {
      throw new AppError("Telefone invalido. Informe entre 8 e 15 digitos.", StatusCodes.BAD_REQUEST);
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new AppError("E-mail ja cadastrado.", StatusCodes.CONFLICT);
    }

    const persistedRole = isAdminEmail(normalizedEmail)
      ? UserRole.ADMIN
      : (role as UserRole | undefined) ?? UserRole.CLIENT;

    // Gera um UUID temporário para poder computar o apelido antes de inserir
    const tempId = crypto.randomUUID();
    const resolvedApelido = apelido
      ? apelido.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30)
      : await generateUniqueApelido(name, tempId);

    // Verifica conflito de apelido
    const apelidoConflict = await prisma.user.findFirst({ where: { apelido: resolvedApelido }, select: { id: true } });
    if (apelidoConflict) {
      throw new AppError("Apelido já está em uso. Escolha outro.", StatusCodes.CONFLICT);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let user: any;
    try {
      user = await prisma.user.create({
      data: {
        id: tempId,
        name,
        apelido: resolvedApelido,
        email: normalizedEmail,
        phone: normalizedPhone,
        password: await hashValue(password),
        role: persistedRole,
        termsAcceptedAt: new Date(),
        privacyPolicyAcceptedAt: new Date(),
        termsVersion: termsVersion.trim()
      },
      select: {
        id: true,
        name: true,
        apelido: true,
        email: true,
        role: true,
        phone: true,
        photoUrl: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = (err.meta?.target as string[] | undefined) ?? [];
        if (target.includes("email")) throw new AppError("E-mail ja cadastrado.", StatusCodes.CONFLICT);
        if (target.includes("apelido")) throw new AppError("Apelido ja esta em uso.", StatusCodes.CONFLICT);
      }
      throw err;
    }

    const effectiveRole = resolveEffectiveUserRole(user!.email, user!.role, user!.emailVerifiedAt);
    const refreshToken = await this.createSession(user!.id);

    try {
      await this.queueEmailVerificationEmail({
        userId: user.id,
        email: user.email,
        name: user.name
      });
    } catch {
      // best effort - registration succeeds even if email enqueue fails
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
      }),
      // Revogar sessões antigas para forçar re-login com nova role efetiva
      prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now }
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

    // Throttle por userId: máx 3 reenvios por hora. Frente 3 (Cadastro/
    // onboarding), Lote 5: sem Redis isso simplesmente não agia, caindo só
    // no rate limiter genérico por IP da rota (20/15min, compartilhado com
    // login/register) - mesmo fallback local já usado no lockout de login.
    if (redis.status === "ready") {
      const key = `auth:resend_verification:${userId}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 3600);
      if (count > 3) {
        throw new AppError(
          "Muitas tentativas de reenvio. Aguarde 1 hora antes de tentar novamente.",
          StatusCodes.TOO_MANY_REQUESTS
        );
      }
    } else {
      const count = incrementLocalLoginAttempts(`resend-verify:${userId}`, 3600);
      if (count > 3) {
        throw new AppError(
          "Muitas tentativas de reenvio. Aguarde 1 hora antes de tentar novamente.",
          StatusCodes.TOO_MANY_REQUESTS
        );
      }
    }

    await this.queueEmailVerificationEmail({
      userId: user.id,
      email: user.email,
      name: user.name
    });
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    await this.ensureLoginNotLocked(normalizedEmail);
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const validPassword = user
      ? await compareHash(password, user.password)
      : await compareHash(password, await this.getDummyPasswordHash()).then(() => false);
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

    if (user.suspendedAt) {
      throw new AppError(
        `Sua conta está suspensa. Motivo: ${user.suspensionReason ?? "não informado"}`,
        StatusCodes.FORBIDDEN
      );
    }

    if (user.twoFactorEnabled) {
      const challengeToken = await this.twoFactorService.createChallengeToken(user.id);
      return { requiresTwoFactor: true as const, challengeToken };
    }

    const effectiveRole = resolveEffectiveUserRole(user.email, user.role, user.emailVerifiedAt);
    const refreshToken = await this.createSession(user.id);
    return {
      user: {
        id: user.id,
        name: user.name,
        apelido: user.apelido,
        email: user.email,
        role: effectiveRole,
        phone: user.phone,
        photoUrl: toUserPhotoUrl(user.id, user.photoUrl, user.updatedAt),
        // Raio-X de pagamentos, Rodada 4, Lote 12: usado pelo app pra mostrar
        // um aviso de "configure 2FA" pra conta admin sem exigir isso no
        // login em si (bloquear o login travaria o admin pra sempre, já que
        // ativar 2FA exige estar logado primeiro).
        twoFactorEnabled: user.twoFactorEnabled
      },
      accessToken: signToken(user.id, effectiveRole),
      refreshToken
    };
  }

  async loginWithTwoFactor(challengeToken: string, code?: string, backupCode?: string) {
    const userId = await this.twoFactorService.resolveAndConsumeChallengeToken(challengeToken);
    if (backupCode) {
      await this.twoFactorService.consumeBackupCode(userId, backupCode);
    } else if (code) {
      await this.twoFactorService.verifyCode(userId, code);
    } else {
      throw new AppError("Informe o codigo do app autenticador ou um codigo de recuperacao.", StatusCodes.BAD_REQUEST);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        apelido: true,
        email: true,
        role: true,
        phone: true,
        photoUrl: true,
        updatedAt: true,
        emailVerifiedAt: true
      }
    });
    if (!user) throw new AppError("Usuario nao encontrado.", StatusCodes.NOT_FOUND);

    const effectiveRole = resolveEffectiveUserRole(user.email, user.role, user.emailVerifiedAt);
    const refreshToken = await this.createSession(user.id);
    return {
      user: {
        id: user.id,
        name: user.name,
        apelido: user.apelido,
        email: user.email,
        role: effectiveRole,
        phone: user.phone,
        photoUrl: toUserPhotoUrl(user.id, user.photoUrl, user.updatedAt),
        twoFactorEnabled: true
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

      // Token revogado sendo reutilizado: possível roubo de token.
      // Revoga todas as sessões ativas do usuário como defesa.
      if (session?.revokedAt) {
        await tx.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        throw new AppError("Sessao comprometida. Faca login novamente.", StatusCodes.UNAUTHORIZED);
      }

      if (!session || session.expiresAt <= new Date()) {
        throw new AppError("Refresh token invalido.", StatusCodes.UNAUTHORIZED);
      }

      const newRefreshToken = await this.createSession(session.userId, tx);
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() }
      });

      const effectiveRole = resolveEffectiveUserRole(
        session.user.email,
        session.user.role,
        session.user.emailVerifiedAt
      );
      return {
        user: {
          id: session.user.id,
          name: session.user.name,
          apelido: session.user.apelido,
          email: session.user.email,
          role: effectiveRole,
          phone: session.user.phone,
          photoUrl: toUserPhotoUrl(
            session.user.id,
            session.user.photoUrl,
            session.user.updatedAt
          ),
          twoFactorEnabled: session.user.twoFactorEnabled
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
    if (session) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ttl = parseDurationToSeconds(env.ACCESS_TOKEN_EXPIRES_IN);
      await setTokenBlacklist(session.userId, nowSeconds, ttl);
    }
  }

  async forgotPassword(input: ForgotPasswordInput) {
    const channel = input.channel ?? "EMAIL";
    const normalizedEmail = input.email?.trim().toLowerCase();
    const genericResponse = {
      message: "Se o e-mail existir, enviaremos instrucoes para redefinir a senha."
    };

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    // Raio-X Muvify, Frente 2 (Segurança do código), Lote 2: e-mail
    // existente gera token + grava no banco + enfileira e-mail antes de
    // responder; e-mail inexistente respondia quase imediato — a
    // diferença de latência (não a mensagem, que já era idêntica) vazava
    // se aquela conta existe. Paga o mesmo custo de bcrypt nos dois casos
    // que retornam cedo, aproximando a ordem de grandeza do tempo total.
    if (!user) {
      await compareHash("dummy-password", await this.getDummyPasswordHash());
      return genericResponse;
    }

    let deliveryEmail: string = user.email;

    if (channel === "RECOVERY_EMAIL") {
      const recoveryEmail = decryptSensitiveText(user.recoveryEmailEncrypted);
      if (!recoveryEmail) {
        // Sem e-mail de recuperação cadastrado — retorna mensagem genérica
        // pra não expor o estado; mesma equalização de timing do ramo acima.
        await compareHash("dummy-password", await this.getDummyPasswordHash());
        return genericResponse;
      }
      deliveryEmail = recoveryEmail;
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

    if (this.emailService.canSendEmail()) {
      try {
        await this.emailQueueService.enqueuePasswordReset({
          to: deliveryEmail,
          name: user.name,
          resetToken
        });
      } catch (error) {
        // best effort: never expose SMTP failures to forgot-password callers
        const reason = error instanceof Error ? error.message : "unknown";
        console.warn(`[AUTH_FORGOT_PASSWORD_EMAIL_FAILED] userId=${user.id} channel=${channel} reason=${reason}`);
      }
    }

    const response: { message: string; resetToken?: string } = genericResponse;

    if (shouldExposeResetToken()) {
      response.resetToken = resetToken;
    }

    return response;
  }

  async resetPassword({ token, newPassword }: ResetPasswordInput) {
    const tokenHash = hashRefreshToken(token);
    const now = new Date();

    const resetUserId = await prisma.$transaction(async (tx) => {
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

      // Invalida outros tokens de reset não usados (defesa em profundidade)
      await tx.passwordResetToken.deleteMany({
        where: { userId: passwordResetToken.userId, usedAt: null, id: { not: passwordResetToken.id } }
      });

      await tx.session.updateMany({
        where: { userId: passwordResetToken.userId, revokedAt: null },
        data: { revokedAt: now }
      });

      return passwordResetToken.userId;
    });

    // Frente 3 (Cadastro/onboarding), Lote 1: sem isso, um access token já
    // emitido (ex: roubado) continuava válido por até ACCESS_TOKEN_EXPIRES_IN
    // depois do reset, na janela exata em que a vítima acredita ter fechado
    // o acesso. Mesmo padrão de changeMyPassword.
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const ttl = parseDurationToSeconds(env.ACCESS_TOKEN_EXPIRES_IN);
    await setTokenBlacklist(resetUserId, nowSeconds, ttl).catch(() => {/* best effort */});
  }
}
