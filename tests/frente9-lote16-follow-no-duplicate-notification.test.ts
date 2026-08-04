import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { followUser } from "../src/modules/community/services/social.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Épico de Frentes, Frente 9, Lote 16: followUser sempre disparava a
// notificação de "novo seguidor", mesmo quando o vínculo já existia
// (upsert idempotente no banco, push não) - seguir repetidamente (ou
// reenviar a mesma ação) floodava o mesmo aviso.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let followerId = "";
let targetId = "";
const createdUserIds: string[] = [];

describe("Frente 9, Lote 16 — seguir repetidamente não floda notificação", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const follower = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Dezesseis Follower",
        email: `${uid("f9l16_follower")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    followerId = follower.id;
    createdUserIds.push(followerId);

    const target = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Dezesseis Target",
        email: `${uid("f9l16_target")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "CLIENT"
      }
    });
    targetId = target.id;
    createdUserIds.push(targetId);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.follow.deleteMany({ where: { followerId } });
    await prisma.userAchievement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("seguir pela primeira vez dispara a notificação de novo seguidor", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    await followUser(followerId, targetId);

    expect(notifySpy).toHaveBeenCalledWith(
      [targetId],
      expect.objectContaining({ data: expect.objectContaining({ type: "NEW_FOLLOWER" }) })
    );
  });

  it("seguir alguém que já se seguia não dispara notificação nova", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    // Já segue a partir do teste anterior - upsert é um no-op no banco.
    await followUser(followerId, targetId);

    expect(notifySpy).not.toHaveBeenCalled();

    const followCount = await prisma.follow.count({ where: { followerId, followingId: targetId } });
    expect(followCount).toBe(1);
  });
});
