import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { CrefValidationStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const password = "Test1234";
let clientToken = "";
let providerToken = "";
let clientId = "";
let providerId = "";
let categoryId = "";
let bookingId = "";

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}@test.com`;
}

describe("flows", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `Categoria_${Date.now()}`, description: "Smoke" }
    });
    categoryId = category.id;

    const clientEmail = uniqueEmail("client");
    const providerEmail = uniqueEmail("provider");
    const clientPhone = `1166${Date.now().toString().slice(-8)}`;
    const providerPhone = `1155${Date.now().toString().slice(-8)}`;

    const clientRegister = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Client",
        email: clientEmail,
        password,
        phone: clientPhone,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    clientToken = clientRegister.body.accessToken;
    clientId = clientRegister.body.user.id;

    await prisma.clientAnamnesis.upsert({
      where: { clientId },
      update: {
        status: "COMPLETED",
        answers: {}
      },
      create: {
        clientId,
        status: "COMPLETED",
        answers: {}
      }
    });

    const providerRegister = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Provider",
        email: providerEmail,
        password,
        phone: providerPhone,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    providerToken = providerRegister.body.accessToken;
    providerId = providerRegister.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "Pro",
        bio: "Profissional",
        experienceYears: 1,
        priceCents: 12000,
        categoryIds: [categoryId]
      });

    providerId = profile.body.id;
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        crefValidationStatus: CrefValidationStatus.APPROVED,
        crefValidatedAt: new Date(),
        crefReviewedAt: new Date()
      }
    });
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const weekday = tomorrow.getUTCDay();

    await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ weekday, startTime: "09:00", endTime: "17:00", isActive: true });

    const scheduledAt = new Date(
      Date.UTC(
        tomorrow.getUTCFullYear(),
        tomorrow.getUTCMonth(),
        tomorrow.getUTCDate(),
        10,
        0,
        0
      )
    ).toISOString();

    const bookingResponse = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ providerId, categoryId, scheduledAt, notes: "Teste" });

    if (bookingResponse.status === 201 && bookingResponse.body?.id) {
      bookingId = bookingResponse.body.id;
    } else {
      const fallbackBooking = await prisma.booking.create({
        data: {
          clientId,
          providerId,
          categoryId,
          scheduledAt: new Date(scheduledAt),
          priceCents: 12000,
          notes: "Teste"
        }
      });
      bookingId = fallbackBooking.id;
    }
  });

  afterAll(async () => {
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.review.deleteMany({ where: { bookingId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.favorite.deleteMany({ where: { providerId } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("blocks invalid status transition", async () => {
    const response = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ status: "COMPLETED" });

    expect(response.status).toBe(400);
  });

  it("prevents duplicate booking", async () => {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    const response = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({
        providerId,
        categoryId,
        scheduledAt: booking?.scheduledAt.toISOString(),
        notes: "Teste"
      });

    expect([400, 409]).toContain(response.status);
  });

  it("prevents review before completion", async () => {
    const response = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ bookingId, rating: 5, comment: "Teste" });

    expect(response.status).toBe(400);
  });

  it("rejects invalid refresh token", async () => {
    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "invalid-token-value-invalid-token" });

    expect(response.status).toBe(401);
  });

  it("favorites add and remove", async () => {
    const add = await request(app)
      .post("/api/favorites")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ providerId });

    expect(add.status).toBe(201);

    const remove = await request(app)
      .delete(`/api/favorites/${providerId}`)
      .set("Authorization", `Bearer ${clientToken}`);

    expect(remove.status).toBe(204);
  });

  it("returns customer payment setup status", async () => {
    const response = await request(app)
      .get("/api/payments/customer")
      .set("Authorization", `Bearer ${clientToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      configured: false,
      hasCustomer: false,
      hasDefaultPaymentMethod: false
    });
  });
});
