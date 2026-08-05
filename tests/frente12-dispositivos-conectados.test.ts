import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Épico de Frentes, "4 temas pendentes" (05/08/2026), Tema 3: tela "Meus
// aparelhos conectados" - lista sessões ativas da conta e permite
// desconectar qualquer uma à distância. O recurso de "recuperar a conta se
// o único aparelho for roubado" já existia antes (resetPassword revoga
// tudo), não é coberto aqui.

const createdUserIds = new Set<string>();

describe("Tema 3 — dispositivos conectados", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const userIds = Array.from(createdUserIds);
    if (userIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function registerUser() {
    const email = `f12dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
    const password = "Test1234";
    const phone = `1199${Date.now().toString().slice(-8)}`;

    const register = await request(app)
      .post("/api/auth/register")
      .set("User-Agent", "MuvifyApp/1.0 (iPhone; Registro)")
      .send({
        name: "Dono de Vários Aparelhos",
        email,
        password,
        phone,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    expect(register.status).toBe(201);
    createdUserIds.add(register.body.user.id);
    return { email, password, userId: register.body.user.id as string };
  }

  it("login grava o user-agent do aparelho e aparece na listagem como 'este aparelho'", async () => {
    const { email, password } = await registerUser();

    const login = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (iPhone 15)")
      .send({ email, password });
    expect(login.status).toBe(200);

    const list = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${login.body.accessToken}`);

    expect(list.status).toBe(200);
    const mine = list.body.find((s: any) => s.isCurrent);
    expect(mine).toBeTruthy();
    expect(mine.userAgent).toContain("iPhone 15");
  });

  it("dois logins (dois aparelhos) aparecem como duas entradas distintas, cada um vendo só o próprio como 'este aparelho'", async () => {
    const { email, password } = await registerUser();

    const loginPhone = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (iPhone)")
      .send({ email, password });
    const loginTablet = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (iPad)")
      .send({ email, password });

    const listFromPhone = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${loginPhone.body.accessToken}`);

    // 3, não 2: o próprio registerUser() já loga (cria sua própria sessão),
    // além dos dois logins explícitos deste teste.
    expect(listFromPhone.body.length).toBe(3);
    const currentEntry = listFromPhone.body.find((s: any) => s.isCurrent);
    const tabletEntry = listFromPhone.body.find((s: any) => s.userAgent?.includes("iPad"));
    expect(currentEntry.userAgent).toContain("iPhone)");
    expect(tabletEntry).toBeTruthy();

    const listFromTablet = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${loginTablet.body.accessToken}`);
    const tabletCurrentEntry = listFromTablet.body.find((s: any) => s.isCurrent);
    expect(tabletCurrentEntry.userAgent).toContain("iPad");
  });

  it("renovar o token (refresh) mantém a identidade do aparelho na lista, sem virar uma entrada nova", async () => {
    const { email, password } = await registerUser();

    const login = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (Aparelho Unico)")
      .send({ email, password });

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });
    expect(refresh.status).toBe(200);

    const list = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${refresh.body.accessToken}`);

    // 2, não 1: a sessão do próprio registerUser() continua ativa à parte -
    // o que importa aqui é que o login+refresh não viraram DUAS entradas
    // (uma pro login, outra pro refresh), continuam sendo uma só.
    expect(list.body.length).toBe(2);
    const current = list.body.find((s: any) => s.isCurrent);
    expect(current.userAgent).toContain("Aparelho Unico");
  });

  it("desconectar outro aparelho impede que ele renove o token depois", async () => {
    const { email, password } = await registerUser();

    const loginA = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (Aparelho A)")
      .send({ email, password });
    const loginB = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (Aparelho B - roubado)")
      .send({ email, password });

    const listFromA = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${loginA.body.accessToken}`);
    const sessionB = listFromA.body.find((s: any) => !s.isCurrent);
    expect(sessionB.userAgent).toContain("Aparelho B");

    const revoke = await request(app)
      .delete(`/api/users/me/security/sessions/${sessionB.id}`)
      .set("Authorization", `Bearer ${loginA.body.accessToken}`);
    expect(revoke.status).toBe(204);

    // O aparelho B perde acesso na próxima tentativa de renovar o token
    // (o access token que ele já tinha em mãos continua funcionando até
    // expirar sozinho - essa é a única checagem instantânea que existe).
    const refreshB = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: loginB.body.refreshToken });
    expect(refreshB.status).toBe(401);

    const listAfter = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${loginA.body.accessToken}`);
    // 2, não 1: sobram a sessão do registerUser() + a do aparelho A.
    expect(listAfter.body.length).toBe(2);
    expect(listAfter.body.some((s: any) => s.userAgent?.includes("Aparelho B"))).toBe(false);
  });

  it("não deixa desconectar sessão de outro usuário", async () => {
    const userA = await registerUser();
    const userB = await registerUser();

    const loginA = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (Usuario A)")
      .send({ email: userA.email, password: userA.password });
    const loginB = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "MuvifyApp/1.0 (Usuario B)")
      .send({ email: userB.email, password: userB.password });

    const listFromB = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${loginB.body.accessToken}`);
    // 2 sessões de B: a do registerUser() + a do login explícito acima -
    // tenta apagar a sessão atual dele mesmo (a mais recente, index 0).
    expect(listFromB.body.length).toBe(2);
    const sessionOfB = listFromB.body.find((s: any) => s.isCurrent).id;

    const attempt = await request(app)
      .delete(`/api/users/me/security/sessions/${sessionOfB}`)
      .set("Authorization", `Bearer ${loginA.body.accessToken}`);
    expect(attempt.status).toBe(404);

    // Confirma que a sessão de B continua ativa (não foi derrubada por engano)
    const stillActive = await request(app)
      .get("/api/users/me/security/sessions")
      .set("Authorization", `Bearer ${loginB.body.accessToken}`);
    expect(stillActive.body.length).toBe(2);
  });
});
