import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { S3Client } from "@aws-sdk/client-s3";
import { BookingStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Fake in-memory R2 so we can assert real upload/download round trips without a
// live Cloudflare account — same mocking strategy as tests/uploads.test.ts.
const fakeR2 = new Map<string, string>();
vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
  const commandName = command.constructor.name;
  if (commandName === "PutObjectCommand") {
    fakeR2.set(command.input.Key, command.input.Body.toString("utf8"));
    return {};
  }
  if (commandName === "GetObjectCommand") {
    const value = fakeR2.get(command.input.Key);
    if (value === undefined) {
      const err = new Error("NoSuchKey");
      err.name = "NoSuchKey";
      throw err;
    }
    return { Body: { transformToString: async () => value } };
  }
  throw new Error(`Unexpected S3 command in test: ${commandName}`);
});

const PASSWORD = "Test1234";
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

let clientToken = "";
let providerToken = "";
let outsiderToken = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
let outsiderId = "";
let categoryId = "";
let bookingId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("completion evidence (selfie de comprovação de presença)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CE_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    let phoneCounter = 0;
    async function registerUser(prefix: string, displayName: string, role?: "PROVIDER") {
      const email = `${uid(prefix)}@test.com`;
      phoneCounter += 1;
      const phone = `11${phoneCounter}${Date.now().toString().slice(-8)}`;
      const reg = await request(app).post("/api/auth/register").send({
        name: displayName,
        email,
        password: PASSWORD,
        phone,
        ...(role ? { role } : {}),
        termsVersion: "2026.05",
        consentAccepted: true
      });
      return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
    }

    const client = await registerUser("ce_client", "CE Client");
    clientToken = client.token;
    clientId = client.userId;

    const provider = await registerUser("ce_provider", "CE Provider", "PROVIDER");
    providerToken = provider.token;
    providerUserId = provider.userId;

    const outsider = await registerUser("ce_outsider", "CE Outsider");
    outsiderToken = outsider.token;
    outsiderId = outsider.userId;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "CE Provider",
        bio: "Provider de teste para comprovacao",
        experienceYears: 3,
        priceCents: 10000,
        categoryIds: [categoryId]
      });
    providerId = profile.body.id;

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED,
        attendanceCodeValidatedAt: new Date()
      }
    });
    bookingId = booking.id;
  });

  afterAll(async () => {
    await prisma.completionEvidence.deleteMany({ where: { bookingId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId, outsiderId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, outsiderId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it("submitting completion proof stores it on R2 (storageKey), not as base64 in Postgres", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({
        status: "COMPLETED",
        completionProof: {
          imageBase64: `data:image/jpeg;base64,${TINY_JPEG_BASE64}`,
          mimeType: "image/jpeg",
          cameraFacing: "FRONT"
        }
      });

    expect(res.status).toBe(200);

    const evidence = await prisma.completionEvidence.findUnique({
      where: { bookingId_userId: { bookingId, userId: clientId } }
    });
    expect(evidence?.storageKey).toBe(`attendance-proofs/${bookingId}_${clientId}.enc`);
    expect(evidence?.imageBase64).toBeNull();
    expect(fakeR2.has(evidence!.storageKey!)).toBe(true);
  });

  it("client and provider can both read back the stored proof, decrypted correctly", async () => {
    const asClient = await request(app)
      .get(`/api/bookings/${bookingId}/completion-proof/${clientId}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(asClient.status).toBe(200);
    expect(asClient.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(asClient.body).toString("base64")).toBe(TINY_JPEG_BASE64);

    const asProvider = await request(app)
      .get(`/api/bookings/${bookingId}/completion-proof/${clientId}`)
      .set("Authorization", `Bearer ${providerToken}`);
    expect(asProvider.status).toBe(200);
  });

  it("rejects a user unrelated to the booking", async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingId}/completion-proof/${clientId}`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a booking/user combination with no evidence", async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingId}/completion-proof/${providerUserId}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(404);
  });

  it("still resolves a legacy row that only has the old imageBase64 column set", async () => {
    const legacyBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED,
        attendanceCodeValidatedAt: new Date()
      }
    });

    await prisma.completionEvidence.create({
      data: {
        bookingId: legacyBooking.id,
        userId: clientId,
        mimeType: "image/jpeg",
        cameraFacing: "FRONT",
        imageBase64: encryptSensitiveText(TINY_JPEG_BASE64)
        // storageKey intentionally left null — simulates a pre-migration row
      }
    });

    const res = await request(app)
      .get(`/api/bookings/${legacyBooking.id}/completion-proof/${clientId}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString("base64")).toBe(TINY_JPEG_BASE64);

    await prisma.completionEvidence.deleteMany({ where: { bookingId: legacyBooking.id } });
    await prisma.booking.deleteMany({ where: { id: legacyBooking.id } });
  });
});
