import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const createdUserIds = new Set<string>();

describe("auth", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const userIds = Array.from(createdUserIds);
    if (userIds.length > 0) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("register, login, refresh and logout", async () => {
    const email = `user_${Date.now()}@test.com`;
    const password = "Test1234";
    const phone = `1199${Date.now().toString().slice(-8)}`;

    const register = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Test User",
        email,
        password,
        phone,
        termsVersion: "2026.05",
        consentAccepted: true
      });

    expect(register.status).toBe(201);
    expect(register.body.accessToken).toBeTruthy();
    expect(register.body.refreshToken).toBeTruthy();
    createdUserIds.add(register.body.user.id);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password });

    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeTruthy();

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });

    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeTruthy();
    expect(refresh.body.refreshToken).toBeTruthy();

    const oldRefreshReuse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });

    expect(oldRefreshReuse.status).toBe(401);

    const logout = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: refresh.body.refreshToken });

    expect(logout.status).toBe(204);
  });

  it("forgot/reset password flow invalidates old password", async () => {
    const email = `reset_${Date.now()}@test.com`;
    const oldPassword = "OldPass123";
    const newPassword = "NewPass123";
    const phone = `1188${Date.now().toString().slice(-8)}`;

    const register = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Reset User",
        email,
        password: oldPassword,
        phone,
        termsVersion: "2026.05",
        consentAccepted: true
      });

    expect(register.status).toBe(201);
    createdUserIds.add(register.body.user.id);

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ channel: "EMAIL", email });

    expect(forgot.status).toBe(200);
    expect(forgot.body.message).toContain("Se o e-mail existir");
    expect(forgot.body.resetToken).toBeTruthy();

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: forgot.body.resetToken, newPassword });

    expect(reset.status).toBe(204);

    const loginOldPassword = await request(app)
      .post("/api/auth/login")
      .send({ email, password: oldPassword });

    expect(loginOldPassword.status).toBe(401);

    const loginNewPassword = await request(app)
      .post("/api/auth/login")
      .send({ email, password: newPassword });

    expect(loginNewPassword.status).toBe(200);

    const reuseResetToken = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: forgot.body.resetToken, newPassword: "Another123" });

    expect(reuseResetToken.status).toBe(400);
  });
});
