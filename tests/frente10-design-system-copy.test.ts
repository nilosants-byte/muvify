import "dotenv/config";
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

// Frente 10 (segunda camada): design system, copy e arquitetura de
// informação.

describe("Frente 10 (segunda camada), Lote 2 — erro de validação não vaza texto técnico em inglês", () => {
  it("nome curto (sem mensagem customizada no schema) vira mensagem em português com o campo real, não 'body'", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "A",
        email: "nao-e-email",
        password: "Test1234",
        phone: "11999998888",
        termsVersion: "2026.05",
        consentAccepted: true
      });

    expect(response.status).toBe(400);
    expect(response.body.message).not.toMatch(/\bbody:/);
    expect(response.body.message).not.toMatch(/must contain|must be greater|Invalid email/i);
    expect(response.body.message).toContain("name:");
    expect(response.body.message).toContain("email:");
    // Mensagem padrão traduzida (schema não tem .min(3, "...") customizado)
    expect(response.body.message).toMatch(/caractere/i);
    expect(response.body.message).toMatch(/e-mail inválido/i);
  });

  it("mensagem customizada do schema (regex com texto próprio) continua intacta, não é sobrescrita pela tradução", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Nome Válido",
        email: "valido@test.com",
        password: "semnumero",
        phone: "11999998888",
        termsVersion: "2026.05",
        consentAccepted: true
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Senha deve conter letras e numeros.");
  });
});
