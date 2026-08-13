import "dotenv/config";
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { env } from "../src/config/env";

// Frente 14 (segunda camada, carga real), Lote 1: POST/PUT /api/providers/profile
// tinha um limite de corpo JSON próprio de 60MB (vestígio da época em que
// foto/vídeo do profissional trafegavam em base64 no corpo — hoje
// `photoUrl`/`presentationVideoUrl` são só URL, já validado por
// provider.validator.ts). Esse parser rodava ANTES de qualquer autenticação
// ou rate limit (aplicado em src/app.ts, não na rota), então um corpo de
// até 60MB era inteiramente bufferizado na memória do processo mesmo sem
// token válido nenhum — um punhado de conexões concorrentes bastava pra
// empurrar o container pra OOM. Corrigido removendo o limite especial dessa
// rota; agora ela cai no limite global (API_JSON_LIMIT, 10mb em teste).

describe("Frente 14, Lote 1 — /api/providers/profile não tem mais limite de corpo maior que o resto da API", () => {
  it("corpo maior que o limite global da API é rejeitado com 413 antes de qualquer lógica de negócio", async () => {
    const oversized = "a".repeat(11 * 1024 * 1024); // 11MB > API_JSON_LIMIT (10mb)
    const response = await request(app)
      .put("/api/providers/profile")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ bio: oversized }));

    expect(response.status).toBe(413);
  });

  it("corpo dentro do limite global sem token de autenticação continua caindo em 401 (comportamento normal preservado)", async () => {
    const response = await request(app)
      .put("/api/providers/profile")
      .set("Content-Type", "application/json")
      .send({ bio: "perfil normal" });

    expect(response.status).toBe(401);
  });

  it("API_JSON_LIMIT segue definido e não existe mais PROVIDER_PROFILE_JSON_LIMIT no schema de env", () => {
    expect(env.API_JSON_LIMIT).toBeTruthy();
    expect("PROVIDER_PROFILE_JSON_LIMIT" in env).toBe(false);
  });
});
