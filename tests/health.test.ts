import request from "supertest";
import { describe, it, expect } from "vitest";
import { app } from "../src/app";

describe("health", () => {
  it("returns health status with checks", async () => {
    const response = await request(app).get("/health");
    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty("status");
    expect(response.body).toHaveProperty("checks");
    expect(["ok", "degraded"]).toContain(response.body.status);
  });
});
