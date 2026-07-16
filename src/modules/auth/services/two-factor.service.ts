import { randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { connectRedis, redis } from "../../../config/redis";
import { AppError } from "../../../shared/errors/app-error";
import { decryptSensitiveText, encryptSensitiveText } from "../../../shared/utils/encryption";
import { compareHash } from "../../../shared/utils/hash";
import { generateRefreshToken, hashRefreshToken } from "../../../shared/utils/refresh-token";

const CHALLENGE_TTL_SECONDS = 300; // 5 minutos
const BACKUP_CODE_COUNT = 8;

export class TwoFactorService {
  async setup(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true }
    });
    if (!user) throw new AppError("Usuario nao encontrado.", StatusCodes.NOT_FOUND);
    if (user.twoFactorEnabled) {
      throw new AppError("Autenticacao em dois fatores ja esta ativa.", StatusCodes.CONFLICT);
    }

    const secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptSensitiveText(secret) }
    });

    const otpAuthUrl = authenticator.keyuri(user.email, "Muvify", secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);

    return { manualEntryKey: secret, qrCodeDataUrl };
  }

  async confirm(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    await this.ensureTwoFactorNotLocked(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true }
    });
    if (!user) throw new AppError("Usuario nao encontrado.", StatusCodes.NOT_FOUND);
    if (user.twoFactorEnabled) {
      throw new AppError("Autenticacao em dois fatores ja esta ativa.", StatusCodes.CONFLICT);
    }
    if (!user.twoFactorSecret) {
      throw new AppError("Inicie o processo de configuracao antes de confirmar.", StatusCodes.BAD_REQUEST);
    }

    const secret = decryptSensitiveText(user.twoFactorSecret);
    if (!secret) {
      throw new AppError("Erro interno ao processar configuracao.", StatusCodes.INTERNAL_SERVER_ERROR);
    }

    if (!authenticator.verify({ token: code, secret })) {
      await this.registerTwoFactorFailure(userId);
      throw new AppError("Codigo invalido. Verifique seu app autenticador e tente novamente.", StatusCodes.BAD_REQUEST);
    }
    await this.clearTwoFactorFailures(userId);

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorEnabledAt: new Date() }
    });

    const backupCodes = await this.generateAndStoreBackupCodes(userId);
    return { backupCodes };
  }

  async disable(userId: string, password: string, code: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, twoFactorEnabled: true, twoFactorSecret: true }
    });
    if (!user) throw new AppError("Usuario nao encontrado.", StatusCodes.NOT_FOUND);
    if (!user.twoFactorEnabled) {
      throw new AppError("Autenticacao em dois fatores nao esta ativa.", StatusCodes.CONFLICT);
    }

    if (!(await compareHash(password, user.password))) {
      throw new AppError("Senha incorreta.", StatusCodes.UNAUTHORIZED);
    }

    const secret = user.twoFactorSecret ? decryptSensitiveText(user.twoFactorSecret) : null;
    if (!secret || !authenticator.verify({ token: code, secret })) {
      throw new AppError("Codigo invalido. Verifique seu app autenticador.", StatusCodes.BAD_REQUEST);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: false, twoFactorEnabledAt: null, twoFactorSecret: null }
      }),
      prisma.twoFactorBackupCode.deleteMany({ where: { userId } })
    ]);
  }

  async createChallengeToken(userId: string): Promise<string> {
    const token = generateRefreshToken();
    const challengeTokenHash = hashRefreshToken(token);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

    await prisma.twoFactorLoginChallenge.deleteMany({
      where: { userId, consumedAt: null }
    });
    await prisma.twoFactorLoginChallenge.create({
      data: {
        userId,
        challengeTokenHash,
        expiresAt
      }
    });

    return token;
  }

  async resolveAndConsumeChallengeToken(token: string): Promise<string> {
    const challengeTokenHash = hashRefreshToken(token);
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const challenge = await tx.twoFactorLoginChallenge.findUnique({
        where: { challengeTokenHash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          consumedAt: true
        }
      });

      if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
        throw new AppError("Sessao expirada. Faca login novamente.", StatusCodes.UNAUTHORIZED);
      }

      const updated = await tx.twoFactorLoginChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now }
      });
      if (updated.count !== 1) {
        throw new AppError("Sessao expirada. Faca login novamente.", StatusCodes.UNAUTHORIZED);
      }

      return challenge.userId;
    });
  }

  // Per-account attempt limit — separate from the IP-based authRateLimiter on the
  // route, which someone with several IPs could otherwise sidestep to keep
  // guessing a specific user's code. Mirrors AuthService's login lockout
  // (LOGIN_MAX_ATTEMPTS / LOGIN_LOCK_MINUTES) so both share one tunable config.
  private twoFactorAttemptsKey(userId: string) {
    return `2fa:attempts:${userId}`;
  }

  private async ensureTwoFactorNotLocked(userId: string) {
    if (env.NODE_ENV === "test") return;
    await connectRedis();
    if (redis.status !== "ready") return;
    const attempts = await redis.get(this.twoFactorAttemptsKey(userId));
    if (attempts && Number(attempts) >= env.LOGIN_MAX_ATTEMPTS) {
      throw new AppError("Muitas tentativas. Tente novamente mais tarde.", StatusCodes.TOO_MANY_REQUESTS);
    }
  }

  private async registerTwoFactorFailure(userId: string) {
    if (env.NODE_ENV === "test") return;
    await connectRedis();
    if (redis.status !== "ready") return;
    const key = this.twoFactorAttemptsKey(userId);
    const attempts = await redis.incr(key);
    if (attempts === 1) {
      await redis.expire(key, env.LOGIN_LOCK_MINUTES * 60);
    }
  }

  private async clearTwoFactorFailures(userId: string) {
    if (env.NODE_ENV === "test") return;
    await connectRedis();
    if (redis.status !== "ready") return;
    await redis.del(this.twoFactorAttemptsKey(userId));
  }

  async verifyCode(userId: string, code: string): Promise<void> {
    await this.ensureTwoFactorNotLocked(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true }
    });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      throw new AppError("Autenticacao em dois fatores nao esta configurada.", StatusCodes.BAD_REQUEST);
    }

    const secret = decryptSensitiveText(user.twoFactorSecret);
    if (!secret) throw new AppError("Erro interno ao verificar codigo.", StatusCodes.INTERNAL_SERVER_ERROR);

    if (!authenticator.verify({ token: code, secret })) {
      await this.registerTwoFactorFailure(userId);
      throw new AppError("Codigo invalido ou expirado.", StatusCodes.BAD_REQUEST);
    }
    await this.clearTwoFactorFailures(userId);

    // Anti-replay: rejeita o mesmo código TOTP dentro da janela de 30s
    // Fail-safe: sem Redis, bloqueia o login para impedir replay attacks
    const replayKey = `totp:used:${userId}:${code}`;
    if (redis.status !== "ready") {
      throw new AppError("Servico de autenticacao temporariamente indisponivel. Tente novamente.", StatusCodes.SERVICE_UNAVAILABLE);
    }
    const already = await redis.set(replayKey, "1", "EX", 90, "NX");
    if (already === null) {
      throw new AppError("Codigo ja utilizado. Aguarde o proximo codigo.", StatusCodes.BAD_REQUEST);
    }
  }

  async consumeBackupCode(userId: string, code: string): Promise<void> {
    const codeHash = hashRefreshToken(code.toLowerCase().trim());

    await prisma.$transaction(async (tx) => {
      const backupCode = await tx.twoFactorBackupCode.findUnique({
        where: { codeHash },
        select: { id: true, userId: true, usedAt: true }
      });

      if (!backupCode || backupCode.userId !== userId || backupCode.usedAt !== null) {
        throw new AppError("Codigo de recuperacao invalido ou ja utilizado.", StatusCodes.UNAUTHORIZED);
      }

      const updated = await tx.twoFactorBackupCode.updateMany({
        where: { id: backupCode.id, usedAt: null },
        data: { usedAt: new Date() }
      });
      if (updated.count !== 1) {
        throw new AppError("Codigo de recuperacao invalido ou ja utilizado.", StatusCodes.UNAUTHORIZED);
      }
    });
  }

  private async generateAndStoreBackupCodes(userId: string): Promise<string[]> {
    await prisma.twoFactorBackupCode.deleteMany({ where: { userId } });

    const codes: string[] = [];
    const data: { userId: string; codeHash: string }[] = [];

    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      const code = randomBytes(8).toString("hex"); // 16 hex chars
      codes.push(code);
      data.push({ userId, codeHash: hashRefreshToken(code) });
    }

    await prisma.twoFactorBackupCode.createMany({ data });
    return codes;
  }
}
