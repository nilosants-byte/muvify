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
});
