import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { S3Client } from "@aws-sdk/client-s3";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// The real Cloudflare R2 upload (S3Client.send) is mocked out here — these tests
// exercise routing/validation (auth, folder field, file presence, magic-byte and
// size checks), not the actual network call to R2.
vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

const PASSWORD = "Test1234";
let token = "";
let userId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Minimal valid 1x1 JPEG (starts with the FF D8 FF magic bytes storage.service.ts checks for).
const VALID_JPEG_BUFFER = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64"
);

const NOT_AN_IMAGE_BUFFER = Buffer.from("this is just plain text, not a jpeg", "utf8");

describe("uploads", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const email = `${uid("upload_user")}@test.com`;
    const phone = `115${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Upload Test User",
      email,
      password: PASSWORD,
      phone,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it("uploads a valid JPEG via multipart and returns the R2 url/mimeType/sizeBytes", async () => {
    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "feed-photos")
      .attach("file", VALID_JPEG_BUFFER, { filename: "photo.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.url).toContain("feed-photos/");
    expect(res.body.mimeType).toBe("image/jpeg");
    expect(res.body.sizeBytes).toBe(VALID_JPEG_BUFFER.byteLength);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post("/api/uploads/media")
      .field("folder", "feed-photos")
      .attach("file", VALID_JPEG_BUFFER, { filename: "photo.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(401);
  });

  it("rejects a request missing the folder field", async () => {
    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", VALID_JPEG_BUFFER, { filename: "photo.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
  });

  it("rejects an invalid folder value", async () => {
    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "not-a-real-folder")
      .attach("file", VALID_JPEG_BUFFER, { filename: "photo.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
  });

  it("rejects a request with no file attached", async () => {
    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "feed-photos");

    expect(res.status).toBe(400);
  });

  it("rejects content whose bytes don't match the declared image type", async () => {
    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "feed-photos")
      .attach("file", NOT_AN_IMAGE_BUFFER, { filename: "fake.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
  });

  it("rejects an unsupported mime type", async () => {
    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "feed-photos")
      .attach("file", NOT_AN_IMAGE_BUFFER, { filename: "fake.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
  });

  it("rejects a file larger than the configured limit", async () => {
    const oversized = Buffer.concat([VALID_JPEG_BUFFER, Buffer.alloc(51 * 1024 * 1024)]);
    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "feed-photos")
      .attach("file", oversized, { filename: "big.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
  }, 30000);
});
