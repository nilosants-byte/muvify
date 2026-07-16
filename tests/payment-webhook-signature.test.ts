import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { env } from "../src/config/env";

// Guards processWebhookEvent's HMAC signature check (src/modules/payments/services/payment.service.ts),
// the trap that stops someone from forging a "payment approved" webhook to unlock a
// booking/consultancy for free. Uses a webhook topic Mercado Pago never actually sends
// ("noop") so a valid signature reaches the end of the function without calling out to
// the real Mercado Pago API to fetch a payment.

function sign(secret: string, dataId: string, requestId: string, ts: string) {
  const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

function webhookRequest() {
  return request(app).post("/api/payments/webhook").set("Content-Type", "application/json");
}

describe("payment webhook signature verification", () => {
  it("accepts a correctly signed, fresh webhook", async () => {
    const dataId = "12345";
    const requestId = "req-abc";
    const ts = Date.now().toString();
    const v1 = sign(env.MP_WEBHOOK_SECRET!, dataId, requestId, ts);

    const res = await webhookRequest()
      .query({ "data.id": dataId })
      .set("x-request-id", requestId)
      .set("x-signature", `ts=${ts},v1=${v1}`)
      .send(JSON.stringify({ topic: "noop", data: { id: dataId } }));

    expect(res.status).toBe(204);
  });

  it("rejects a request with no signature header at all", async () => {
    const res = await webhookRequest()
      .query({ "data.id": "12345" })
      .set("x-request-id", "req-abc")
      .send(JSON.stringify({ topic: "noop", data: { id: "12345" } }));

    expect(res.status).toBe(400);
  });

  it("rejects a forged signature (wrong v1)", async () => {
    const dataId = "12345";
    const requestId = "req-abc";
    const ts = Date.now().toString();

    const res = await webhookRequest()
      .query({ "data.id": dataId })
      .set("x-request-id", requestId)
      .set("x-signature", `ts=${ts},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`)
      .send(JSON.stringify({ topic: "noop", data: { id: dataId } }));

    expect(res.status).toBe(400);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const dataId = "12345";
    const requestId = "req-abc";
    const ts = Date.now().toString();
    const v1 = sign("not-the-real-secret", dataId, requestId, ts);

    const res = await webhookRequest()
      .query({ "data.id": dataId })
      .set("x-request-id", requestId)
      .set("x-signature", `ts=${ts},v1=${v1}`)
      .send(JSON.stringify({ topic: "noop", data: { id: dataId } }));

    expect(res.status).toBe(400);
  });

  it("rejects a stale timestamp outside the 5-minute freshness window", async () => {
    const dataId = "12345";
    const requestId = "req-abc";
    const ts = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes old
    const v1 = sign(env.MP_WEBHOOK_SECRET!, dataId, requestId, ts);

    const res = await webhookRequest()
      .query({ "data.id": dataId })
      .set("x-request-id", requestId)
      .set("x-signature", `ts=${ts},v1=${v1}`)
      .send(JSON.stringify({ topic: "noop", data: { id: dataId } }));

    expect(res.status).toBe(400);
  });

  it("rejects a replayed signature for a different data.id than it was signed for", async () => {
    const requestId = "req-abc";
    const ts = Date.now().toString();
    const v1 = sign(env.MP_WEBHOOK_SECRET!, "original-id", requestId, ts);

    const res = await webhookRequest()
      .query({ "data.id": "different-id" })
      .set("x-request-id", requestId)
      .set("x-signature", `ts=${ts},v1=${v1}`)
      .send(JSON.stringify({ topic: "noop", data: { id: "different-id" } }));

    expect(res.status).toBe(400);
  });

  it("rejects a malformed signature header (missing v1 part)", async () => {
    const dataId = "12345";
    const requestId = "req-abc";
    const ts = Date.now().toString();

    const res = await webhookRequest()
      .query({ "data.id": dataId })
      .set("x-request-id", requestId)
      .set("x-signature", `ts=${ts}`)
      .send(JSON.stringify({ topic: "noop", data: { id: dataId } }));

    expect(res.status).toBe(400);
  });

  it("rejects an invalid JSON payload", async () => {
    const res = await webhookRequest()
      .set("x-request-id", "req-abc")
      .set("x-signature", "ts=123,v1=abc")
      .send("{not valid json");

    expect(res.status).toBe(400);
  });
});
