import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Teste manual C13.1 (22/10/2026): "apagar" notificação só marcava como
// lida (central) ou escondia no próprio aparelho (sino) — voltava ao
// atualizar. Apagar agora esconde de verdade, em todo aparelho.
const service = new NotificationService();
let userId = "";

describe("apagar notificações", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Notif Dismiss", email: `notif_dismiss_${Date.now()}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}8`, role: "CLIENT" }
    });
    userId = user.id;
    await prisma.userNotification.createMany({
      data: [1, 2, 3].map((i) => ({ userId, title: `N${i}`, body: "b" }))
    });
  });
  afterAll(async () => {
    await prisma.userNotification.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("apagar uma some da lista e do contador, sem voltar", async () => {
    const [first] = await service.listInbox(userId);
    await service.dismiss(userId, first.id);
    const after = await service.listInbox(userId);
    expect(after.map((n) => n.id)).not.toContain(first.id);
    expect(after).toHaveLength(2);
    expect(await service.unreadCount(userId)).toBe(2);
    // a linha continua existindo (histórico/exportação)
    expect(await prisma.userNotification.count({ where: { userId } })).toBe(3);
  });

  it("apagar todas esvazia a lista e zera o contador", async () => {
    await service.dismissAll(userId);
    expect(await service.listInbox(userId)).toHaveLength(0);
    expect(await service.unreadCount(userId)).toBe(0);
  });

  it("não apaga notificação de outra pessoa", async () => {
    const other = await prisma.user.create({
      data: { name: "Outro", email: `notif_other_${Date.now()}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}9`, role: "CLIENT" }
    });
    const n = await prisma.userNotification.create({ data: { userId: other.id, title: "x", body: "y" } });
    await service.dismiss(userId, n.id);
    expect((await prisma.userNotification.findUniqueOrThrow({ where: { id: n.id } })).dismissedAt).toBeNull();
    await prisma.userNotification.deleteMany({ where: { userId: other.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});
