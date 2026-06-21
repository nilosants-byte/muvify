import request from "supertest";
import { describe, it, expect } from "vitest";
import { app } from "../src/app";

describe("health", () => {
  it("returns health status with checks", async () => {
    const response = await request(app).get("/health");
    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty("status");
    expect(response.body).toHaveProperty("readiness");
    expect(response.body).toHaveProperty("requiredChecks");
    expect(response.body).toHaveProperty("checks");
    expect(["ok", "degraded"]).toContain(response.body.status);
    expect(["ready", "not_ready"]).toContain(response.body.readiness);

    if (response.status === 200) {
      expect(response.body.readiness).toBe("ready");
    }

    if (response.status === 503) {
      expect(response.body.readiness).toBe("not_ready");
    }
  });
});
