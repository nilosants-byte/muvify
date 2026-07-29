import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Épico de Frentes, Frente 2 (Segurança do código), Lote 1: createProfile/
// updateProfile usavam include (não select) na raiz do Prisma, devolvendo
// mpAccessToken/mpRefreshToken/mpAccountId e credentialDocuments/
// crefDocumentUrl (documento de identidade) na resposta da API — toda vez
// que o profissional editava o próprio perfil.

const PASSWORD = "Test1234";
const SENSITIVE_FIELDS = [
  "mpAccessToken",
  "mpRefreshToken",
  "mpAccountId",
  "mpTokenExpiresAt",
  "mpTokenInvalidatedAt",
  "credentialDocuments",
  "crefDocumentUrl",
  "crefRejectionReason",
  "crefRejectionCount",
  "crefReviewedByUserId"
];

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("Frente 2, Lote 1 — perfil do profissional não vaza token MP nem documento de CREF", () => {
  let token = "";
  let userId = "";
  let providerId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const reg = await request(app).post("/api/auth/register").send({
      name: "Lote Um Segurança",
      email: `${uid("f2l1_provider")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;
  });

  afterAll(async () => {
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("POST /providers/profile não devolve campos sensíveis (perfil recém-criado)", async () => {
    const res = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        displayName: "Lote Um Segurança",
        bio: "Bio de teste com mais de dez caracteres.",
        experienceYears: 2,
        priceCents: 10000,
        categoryIds: []
      });
    expect(res.status).toBe(201);
    providerId = res.body.id;

    for (const field of SENSITIVE_FIELDS) {
      expect(res.body).not.toHaveProperty(field);
    }
  });

  it("PUT /providers/profile não devolve mpAccessToken/mpRefreshToken/credentialDocuments mesmo quando já preenchidos no banco", async () => {
    // Popula os campos sensíveis diretamente no banco, simulando um
    // profissional que já conectou o Mercado Pago e já enviou CREF.
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccessToken: encryptSensitiveText("fake_access_token_secreto"),
        mpRefreshToken: encryptSensitiveText("fake_refresh_token_secreto"),
        mpAccountId: "123456789",
        crefDocumentUrl: "https://storage.example.com/cref-documents/documento-real.jpg",
        credentialDocuments: [
          { name: "frente", uri: "cref-documents/real-key-front.jpg", mimeType: "image/jpeg" },
          { name: "verso", uri: "cref-documents/real-key-back.jpg", mimeType: "image/jpeg" }
        ]
      }
    });

    const res = await request(app)
      .put("/api/providers/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "Bio atualizada com mais de dez caracteres." });

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("Bio atualizada com mais de dez caracteres.");

    for (const field of SENSITIVE_FIELDS) {
      expect(res.body).not.toHaveProperty(field);
    }

    // Confirma que os dados sensíveis continuam intactos no banco (a
    // correção é só sobre o que sai na resposta, não sobre apagar o dado).
    const stored = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(stored.mpAccessToken).not.toBeNull();
    expect(stored.credentialDocuments).not.toBeNull();
  });
});
