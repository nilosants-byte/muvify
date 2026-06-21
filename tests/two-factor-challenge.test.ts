import { StatusCodes } from "http-status-codes";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";
import { TwoFactorService } from "../src/modules/auth/services/two-factor.service";
import { hashValue } from "../src/shared/utils/hash";
import { hashRefreshToken } from "../src/shared/utils/refresh-token";

const twoFactorService = new TwoFactorService();
let userId = "";

describe("two-factor-challenge", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const email = `twofactor_${Date.now()}@test.com`;
    const user = await prisma.user.create({
      data: {
        name: "Two Factor User",
        email,
        password: await hashValue("Test1234"),
        phone: `1166${Date.now().toString().slice(-8)}`
      },
      select: { id: true }
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.twoFactorLoginChallenge.deleteMany({ where: { userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("persiste challenge no banco e permite consumo unico", async () => {
    const challengeToken = await twoFactorService.createChallengeToken(userId);
    const challengeTokenHash = hashRefreshToken(challengeToken);

    const stored = await prisma.twoFactorLoginChallenge.findUnique({
      where: { challengeTokenHash },
      select: { userId: true, consumedAt: true, expiresAt: true }
    });

    expect(stored?.userId).toBe(userId);
    expect(stored?.consumedAt).toBeNull();
    expect((stored?.expiresAt?.getTime() ?? 0) > Date.now()).toBe(true);

    const resolvedUserId = await twoFactorService.resolveAndConsumeChallengeToken(challengeToken);
    expect(resolvedUserId).toBe(userId);

    const consumed = await prisma.twoFactorLoginChallenge.findUnique({
      where: { challengeTokenHash },
      select: { consumedAt: true }
    });
    expect(consumed?.consumedAt).toBeTruthy();

    await expect(
      twoFactorService.resolveAndConsumeChallengeToken(challengeToken)
    ).rejects.toMatchObject({
      statusCode: StatusCodes.UNAUTHORIZED
    });
  });

  it("rejeita challenge expirado", async () => {
    const challengeToken = await twoFactorService.createChallengeToken(userId);
    const challengeTokenHash = hashRefreshToken(challengeToken);

    await prisma.twoFactorLoginChallenge.update({
      where: { challengeTokenHash },
      data: { expiresAt: new Date(Date.now() - 1_000) }
    });

    await expect(
      twoFactorService.resolveAndConsumeChallengeToken(challengeToken)
    ).rejects.toMatchObject({
      statusCode: StatusCodes.UNAUTHORIZED
    });
  });
});
