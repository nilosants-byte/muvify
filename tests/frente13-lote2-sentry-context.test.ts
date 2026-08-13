import "dotenv/config";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// Frente 13 (segunda camada), Lote 2: sentryBeforeSend (Frente 11) já
// removia email/ip de event.user, mas ninguém preenchia event.user.id pra
// começo de conversa — todo evento chegava ao Sentry "pelado", sem conta
// afetada nem jeito de correlacionar com o x-request-id que o cliente já
// recebe em toda resposta de erro.
//
// vi.spyOn direto no namespace do @sentry/node não funciona (ESM,
// "Module namespace is not configurable") — vi.mock intercepta a
// resolução do módulo antes de qualquer import (inclusive dentro de
// src/app.ts e src/middlewares/auth.middleware.ts), preservando o
// comportamento real via importOriginal.
vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  return {
    ...actual,
    setUser: vi.fn(actual.setUser),
    setTag: vi.fn(actual.setTag)
  };
});

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("Frente 13, Lote 2 — contexto de usuário e request-id no Sentry", () => {
  it("requisição autenticada chama Sentry.setUser com id/role (sem e-mail)", async () => {
    const { app } = await import("../src/app");
    const Sentry = await import("@sentry/node");

    const email = `${uid("f13l2")}@test.com`;
    const registerResponse = await request(app).post("/api/auth/register").send({
      name: "Frente Treze Lote Dois",
      email,
      password: "Test1234",
      phone: `11${Date.now().toString().slice(-9)}1`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    const token = registerResponse.body.accessToken as string;
    const userId = registerResponse.body.user.id as string;

    vi.mocked(Sentry.setUser).mockClear();
    const meResponse = await request(app).get("/api/users/me").set("Authorization", `Bearer ${token}`);
    expect(meResponse.status).toBe(200);

    expect(Sentry.setUser).toHaveBeenCalledWith(expect.objectContaining({ id: userId, role: "CLIENT" }));
    const lastCall = vi.mocked(Sentry.setUser).mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastCall?.email).toBeUndefined();
  });

  it("toda requisição (autenticada ou não) marca a tag request_id, igual o x-request-id devolvido no header", async () => {
    const { app } = await import("../src/app");
    const Sentry = await import("@sentry/node");

    vi.mocked(Sentry.setTag).mockClear();
    const response = await request(app).get("/health");
    const headerRequestId = response.headers["x-request-id"];
    expect(headerRequestId).toBeTruthy();

    const requestIdCalls = vi.mocked(Sentry.setTag).mock.calls.filter(([tag]) => tag === "request_id");
    expect(requestIdCalls.length).toBeGreaterThan(0);
    expect(requestIdCalls.at(-1)?.[1]).toBe(headerRequestId);
  });
});
