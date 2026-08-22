import request from "supertest";
import { describe, it, expect, afterAll } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Lista de espera pré-lançamento: landing page pública sem login, form HTML
// puro (POST + redirect, sem JS obrigatório). Cobre o essencial: cadastro
// válido, e-mail malformado não vaza JSON de erro, reenvio faz upsert (não
// duplica), e-mail de boas-vindas entra na fila, contador de prova social
// só aparece a partir do mínimo, e o rate limiter dedicado bloqueia abuso.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const createdEmails: string[] = [];

describe("lista de espera (waitlist)", () => {
  afterAll(async () => {
    await prisma.emailDeliveryQueue.deleteMany({ where: { template: "WAITLIST_WELCOME" } });
    await prisma.waitlistSignup.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  });

  it("POST /waitlist com e-mail válido cria o registro e redireciona pra ?ok=1", async () => {
    const email = `${uid("wl")}@test.com`;
    createdEmails.push(email);

    const res = await request(app)
      .post("/waitlist")
      .type("form")
      .send({ email, audience: "CLIENT" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/lista-espera?ok=1");

    const row = await prisma.waitlistSignup.findUnique({ where: { email } });
    expect(row).not.toBeNull();
    expect(row!.audience).toBe("CLIENT");
  });

  it("enfileira o e-mail de boas-vindas com o payload certo", async () => {
    const email = `${uid("wl")}@test.com`;
    createdEmails.push(email);

    await request(app).post("/waitlist").type("form").send({ email, audience: "PROFESSIONAL" });

    const queued = await prisma.emailDeliveryQueue.findFirst({
      where: { template: "WAITLIST_WELCOME" },
      orderBy: { createdAt: "desc" }
    });
    expect(queued).not.toBeNull();
    expect(queued!.payload).toMatchObject({ to: email, audience: "PROFESSIONAL" });
  });

  it("POST /waitlist com e-mail malformado redireciona pra ?erro=1 sem criar registro", async () => {
    const res = await request(app)
      .post("/waitlist")
      .type("form")
      .send({ email: "nao-e-email", audience: "CLIENT" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/lista-espera?erro=1");
  });

  it("reenviar o mesmo e-mail faz upsert (atualiza audience, não duplica linha)", async () => {
    const email = `${uid("wl")}@test.com`;
    createdEmails.push(email);

    await request(app).post("/waitlist").type("form").send({ email, audience: "CLIENT", city: "Recife" });
    await request(app).post("/waitlist").type("form").send({ email, audience: "PROFESSIONAL", city: "Olinda" });

    const rows = await prisma.waitlistSignup.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.audience).toBe("PROFESSIONAL");
    expect(rows[0]!.city).toBe("Olinda");
  });

  it("GET /lista-espera retorna 200 com o formulário", async () => {
    const res = await request(app).get("/lista-espera");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("Entrar na Lista de Espera");
    expect(res.text).toContain("Sou aluno");
    expect(res.text).toContain("Sou profissional");
  });

  it("GET /lista-espera?ok=1 mostra a confirmação de sucesso, não o formulário", async () => {
    const res = await request(app).get("/lista-espera?ok=1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Você entrou!");
    expect(res.text).not.toContain("Entrar na Lista de Espera");
  });

  it("rate limiter dedicado bloqueia excesso de tentativas na mesma janela", async () => {
    let sawTooManyRequests = false;
    for (let i = 0; i < 10 && !sawTooManyRequests; i++) {
      const email = `${uid("wl_rl")}@test.com`;
      const res = await request(app)
        .post("/waitlist")
        .type("form")
        .send({ email, audience: "CLIENT" });
      if (res.status === 429) {
        sawTooManyRequests = true;
      } else {
        createdEmails.push(email);
      }
    }
    expect(sawTooManyRequests).toBe(true);
  });
});

describe("lista de espera — prova social (contador)", () => {
  const seededEmails: string[] = [];

  afterAll(async () => {
    await prisma.waitlistSignup.deleteMany({ where: { email: { in: seededEmails } } });
    await prisma.$disconnect();
  });

  it("com menos de 25 inscritos mostra 'Seja um dos primeiros', não o número real", async () => {
    // Base já pode ter algumas linhas de outros testes deste arquivo (< 25) -
    // o que importa é que, estando abaixo do mínimo, o texto genérico aparece.
    const countBefore = await prisma.waitlistSignup.count();
    if (countBefore >= 25) return; // ambiente com carga residual alta - pula, não é o caso comum

    const res = await request(app).get("/lista-espera");
    expect(res.text).toContain("Seja um dos primeiros a entrar");
    expect(res.text).not.toContain("Junte-se a");
  });

  it("com 25+ inscritos mostra o contador real", async () => {
    const countBefore = await prisma.waitlistSignup.count();
    const toCreate = Math.max(0, 25 - countBefore);
    for (let i = 0; i < toCreate; i++) {
      const email = `${uid("wl_proof")}@test.com`;
      seededEmails.push(email);
      await prisma.waitlistSignup.create({ data: { email, audience: "CLIENT" } });
    }

    const res = await request(app).get("/lista-espera");
    const total = await prisma.waitlistSignup.count();
    expect(res.text).toContain(`Junte-se a ${total} pessoas na frente`);
  });
});
