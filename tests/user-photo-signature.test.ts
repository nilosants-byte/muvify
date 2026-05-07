import { randomUUID } from "crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import {
  createUserPhotoSignatureQuery,
  verifyUserPhotoSignature
} from "../src/shared/utils/user-photo-signature";

describe("user-photo-signature", () => {
  it("generates a valid signature query and verifies it", () => {
    const userId = randomUUID();
    const query = createUserPhotoSignatureQuery(userId);
    const params = new URLSearchParams(query);

    const exp = params.get("exp");
    const sig = params.get("sig");

    expect(typeof exp).toBe("string");
    expect(typeof sig).toBe("string");
    expect(
      verifyUserPhotoSignature({
        userId,
        exp: exp ?? undefined,
        sig: sig ?? undefined
      })
    ).toBe(true);
  });

  it("rejects tampered, mismatched, and expired signatures", () => {
    const userId = randomUUID();
    const query = createUserPhotoSignatureQuery(userId);
    const params = new URLSearchParams(query);
    const exp = params.get("exp")!;
    const sig = params.get("sig")!;

    expect(
      verifyUserPhotoSignature({
        userId: randomUUID(),
        exp,
        sig
      })
    ).toBe(false);

    expect(
      verifyUserPhotoSignature({
        userId,
        exp: String(Math.floor(Date.now() / 1000) - 5),
        sig
      })
    ).toBe(false);

    expect(
      verifyUserPhotoSignature({
        userId,
        exp,
        sig: `${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`
      })
    ).toBe(false);
  });

  it("enforces exp/sig on user photo route", async () => {
    const userId = randomUUID();

    const missingQuery = await request(app).get(`/api/users/${userId}/photo`);
    expect(missingQuery.status).toBe(400);

    const invalidSig = await request(app)
      .get(`/api/users/${userId}/photo`)
      .query({ exp: Math.floor(Date.now() / 1000) + 60, sig: "a".repeat(64) });
    expect(invalidSig.status).toBe(403);

    const query = createUserPhotoSignatureQuery(userId);
    const validSigUnknownUser = await request(app).get(`/api/users/${userId}/photo?${query}`);
    expect(validSigUnknownUser.status).toBe(404);
  });
});
