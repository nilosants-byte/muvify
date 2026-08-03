import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const createdUserIds = new Set<string>();
const testPushToken = "ExponentPushToken[unitTestToken123]";

describe("notifications", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const userIds = Array.from(createdUserIds);
    if (userIds.length > 0) {
      await prisma.pushDevice.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("registers, lists and unregisters push devices", async () => {
    const email = `push_${Date.now()}@test.com`;
    const password = "Test1234";
    const phone = `1177${Date.now().toString().slice(-8)}`;

    const register = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Push User",
        email,
        password,
        phone,
        termsVersion: "2026.05",
        consentAccepted: true
      });

    expect(register.status).toBe(201);
    const accessToken = register.body.accessToken as string;
    const userId = register.body.user.id as string;
    createdUserIds.add(userId);

    const registerDevice = await request(app)
      .post("/api/notifications/devices")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        token: testPushToken,
        platform: "android",
        appVersion: "1.0.0",
        deviceName: "Pixel Test"
      });

    expect(registerDevice.status).toBe(201);
    expect(registerDevice.body.token).toBe(testPushToken);
    expect(registerDevice.body.platform).toBe("ANDROID");
    expect(registerDevice.body.isActive).toBe(true);

    const list = await request(app)
      .get("/api/notifications/devices")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body[0].token).toBe(testPushToken);

    const sendTest = await request(app)
      .post("/api/notifications/test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        title: "Teste",
        body: "Mensagem de teste",
        data: {
          kind: "TEST_NOTIFICATION"
        }
      });

    expect(sendTest.status).toBe(202);
    expect(sendTest.body).toMatchObject({
      attempted: 0,
      delivered: 0,
      disabled: true
    });

    const unregister = await request(app)
      .delete("/api/notifications/devices")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ token: testPushToken });

    expect(unregister.status).toBe(204);

    const inactiveDevice = await prisma.pushDevice.findUnique({
      where: { token: testPushToken }
    });

    expect(inactiveDevice?.isActive).toBe(false);
  });

  // Épico de Frentes, Frente 9, Lote 2: não existia endpoint pra marcar UMA
  // notificação como lida - a tela cheia só atualizava um cache local.
  it("marca uma notificação como lida, sem afetar as de outro usuário nem duplicar contagem", async () => {
    const emailA = `markread_a_${Date.now()}@test.com`;
    const emailB = `markread_b_${Date.now()}@test.com`;
    const password = "Test1234";

    const registerA = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Mark Read User A",
        email: emailA,
        password,
        phone: `1188${Date.now().toString().slice(-8)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    expect(registerA.status).toBe(201);
    const tokenA = registerA.body.accessToken as string;
    const userIdA = registerA.body.user.id as string;
    createdUserIds.add(userIdA);

    const registerB = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Mark Read User B",
        email: emailB,
        password,
        phone: `1199${Date.now().toString().slice(-8)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    expect(registerB.status).toBe(201);
    const tokenB = registerB.body.accessToken as string;
    const userIdB = registerB.body.user.id as string;
    createdUserIds.add(userIdB);

    const notificationA = await prisma.userNotification.create({
      data: { userId: userIdA, title: "Teste A", body: "Corpo A" }
    });
    const notificationB = await prisma.userNotification.create({
      data: { userId: userIdB, title: "Teste B", body: "Corpo B" }
    });

    const unreadBefore = await request(app)
      .get("/api/notifications/inbox/unread-count")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(unreadBefore.body.unread).toBe(1);

    const markOtherUsers = await request(app)
      .patch(`/api/notifications/inbox/${notificationB.id}/read`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(markOtherUsers.status).toBe(204);

    const untouched = await prisma.userNotification.findUnique({ where: { id: notificationB.id } });
    expect(untouched?.readAt).toBeNull();

    const markOwn = await request(app)
      .patch(`/api/notifications/inbox/${notificationA.id}/read`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(markOwn.status).toBe(204);

    const readNotification = await prisma.userNotification.findUnique({ where: { id: notificationA.id } });
    expect(readNotification?.readAt).not.toBeNull();

    const unreadAfter = await request(app)
      .get("/api/notifications/inbox/unread-count")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(unreadAfter.body.unread).toBe(0);

    const markAgain = await request(app)
      .patch(`/api/notifications/inbox/${notificationA.id}/read`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(markAgain.status).toBe(204);

    const stillRead = await prisma.userNotification.findUnique({ where: { id: notificationA.id } });
    expect(stillRead?.readAt?.getTime()).toBe(readNotification?.readAt?.getTime());

    await prisma.userNotification.deleteMany({ where: { id: { in: [notificationA.id, notificationB.id] } } });
  });
});
