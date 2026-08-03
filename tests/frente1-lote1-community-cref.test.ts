import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { S3Client } from "@aws-sdk/client-s3";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Épico de Frentes, Frente 1 (Autorização/IDOR), Lote 1:
// (1) documento de CREF passa a ir pro storage privado, exibido só via
//     rota assinada de curta duração.
// (2) curtir/comentar/listar comentários de um post passa a respeitar a
//     mesma visibilidade do feed (só o próprio autor ou quem o segue).
// (3) XP de post manual não pode mais ser farmado criando e apagando o
//     post rapidamente.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const VALID_JPEG_BUFFER = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64"
);

describe("Frente 1, Lote 1 — documento de CREF privado", () => {
  let token = "";
  let userId = "";
  let providerId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const email = `${uid("f1l1_provider")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Frente Um Provider",
      email,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ displayName: "Frente Um Provider", bio: "Bio de teste com mais de dez caracteres.", experienceYears: 2, priceCents: 10000, categoryIds: [] });
    providerId = profile.body.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("upload de documento CREF vai pro storage privado, não devolve URL pública", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    const res = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "cref-documents")
      .attach("file", VALID_JPEG_BUFFER, { filename: "cref-front.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^cref-documents\//);
    expect(res.body.url).not.toMatch(/^https?:\/\//);
  });

  it("getOwnCredentials devolve o documento como URL relativa assinada, não a chave crua", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    const frontUpload = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "cref-documents")
      .attach("file", VALID_JPEG_BUFFER, { filename: "front.jpg", contentType: "image/jpeg" });
    const backUpload = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "cref-documents")
      .attach("file", VALID_JPEG_BUFFER, { filename: "back.jpg", contentType: "image/jpeg" });
    const frontKey = frontUpload.body.url as string;
    const backKey = backUpload.body.url as string;

    await request(app)
      .put("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crefNumber: `CREF-${Date.now()}A`,
        credentials: [
          { name: "frente", uri: frontKey, mimeType: "image/jpeg" },
          { name: "verso", uri: backKey, mimeType: "image/jpeg" }
        ]
      });

    const res = await request(app)
      .get("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const frontUri = res.body.credentials[0].uri as string;
    const frontKeyName = frontKey.replace("cref-documents/", "");
    expect(frontUri).toMatch(new RegExp(`^/providers/${providerId}/credentials/documents/${frontKeyName}\\?exp=\\d+&sig=[a-f0-9]{64}$`));
  });

  it("rota assinada serve o documento com assinatura válida", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: { transformToByteArray: async () => bytes }
    } as never);

    const frontUpload = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "cref-documents")
      .attach("file", VALID_JPEG_BUFFER, { filename: "served-front.jpg", contentType: "image/jpeg" });
    const backUpload = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${token}`)
      .field("folder", "cref-documents")
      .attach("file", VALID_JPEG_BUFFER, { filename: "served-back.jpg", contentType: "image/jpeg" });

    await request(app)
      .put("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crefNumber: `CREF-${Date.now()}B`,
        credentials: [
          { name: "frente", uri: frontUpload.body.url, mimeType: "image/jpeg" },
          { name: "verso", uri: backUpload.body.url, mimeType: "image/jpeg" }
        ]
      });
    const credRes = await request(app)
      .get("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${token}`);
    const signedPath = credRes.body.credentials[0].uri as string;

    const streamRes = await request(app).get(`/api${signedPath}`);
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers["content-type"]).toBe("image/jpeg");
  });

  it("rota assinada rejeita assinatura inválida", async () => {
    const res = await request(app).get(
      `/api/providers/${providerId}/credentials/documents/served-key.jpg?exp=9999999999&sig=deadbeef`
    );
    expect(res.status).toBe(403);
  });

  it("rota assinada rejeita assinatura expirada", async () => {
    const expiredExp = Math.floor(Date.now() / 1000) - 60;
    const res = await request(app).get(
      `/api/providers/${providerId}/credentials/documents/served-key.jpg?exp=${expiredExp}&sig=${"a".repeat(64)}`
    );
    expect(res.status).toBe(403);
  });
});

describe("Frente 1, Lote 1 — visibilidade de curtir/comentar segue o feed", () => {
  let tokenA = "";
  let userAId = "";
  let tokenB = "";
  let userBId = "";
  let postAId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const regA = await request(app).post("/api/auth/register").send({
      name: "Vis A",
      email: `${uid("vis_a")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const regB = await request(app).post("/api/auth/register").send({
      name: "Vis B",
      email: `${uid("vis_b")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}2`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    tokenB = regB.body.accessToken;
    userBId = regB.body.user.id;

    const post = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ caption: "Post da A, visibilidade" });
    expect(post.status).toBe(201);
    const created = await prisma.feedPost.findFirst({ where: { userId: userAId }, orderBy: { createdAt: "desc" } });
    postAId = created!.id;
  });

  afterAll(async () => {
    await prisma.feedPostComment.deleteMany({ where: { postId: postAId } });
    await prisma.feedPostLike.deleteMany({ where: { postId: postAId } });
    await prisma.feedPost.deleteMany({ where: { id: postAId } });
    await prisma.follow.deleteMany({ where: { OR: [{ followerId: userBId }, { followingId: userBId }] } });
    await prisma.session.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
  });

  it("B (não segue A) não consegue curtir o post de A", async () => {
    const res = await request(app)
      .post(`/api/community/feed/posts/${postAId}/like`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("B (não segue A) não consegue comentar no post de A", async () => {
    const res = await request(app)
      .post(`/api/community/feed/posts/${postAId}/comments`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ content: "tentando comentar sem seguir" });
    expect(res.status).toBe(404);
  });

  it("B (não segue A) não consegue listar comentários do post de A", async () => {
    const res = await request(app)
      .get(`/api/community/feed/posts/${postAId}/comments`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("depois que B passa a seguir A, curtir/comentar/listar funcionam normalmente", async () => {
    const follow = await request(app)
      .post(`/api/community/follow/${userAId}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(follow.status).toBe(204);

    const like = await request(app)
      .post(`/api/community/feed/posts/${postAId}/like`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect([200, 201]).toContain(like.status);

    const comment = await request(app)
      .post(`/api/community/feed/posts/${postAId}/comments`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ content: "agora posso comentar" });
    expect(comment.status).toBe(201);

    const list = await request(app)
      .get(`/api/community/feed/posts/${postAId}/comments`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(list.status).toBe(200);
  });
});

describe("Frente 1, Lote 1 — farm de XP via post manual", () => {
  let token = "";
  let userId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const reg = await request(app).post("/api/auth/register").send({
      name: "XP Farm",
      email: `${uid("xp_farm")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}3`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;
  });

  afterAll(async () => {
    await prisma.userXpTransaction.deleteMany({ where: { userId } });
    await prisma.feedPost.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("criar e apagar o post na hora não deixa XP líquido positivo", async () => {
    const before = await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    const beforeTotal = before._sum.amount ?? 0;

    const create = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${token}`)
      // Épico de Frentes, Frente 8, Lote 1: XP de POST_WORKOUT_PHOTO só é
      // concedido quando o post tem imageUrl de verdade (antes, um post só
      // com caption já farmava o mesmo XP de "foto de treino").
      .send({ caption: "post pra farmar XP", imageUrl: "https://fake-r2-public.test/feed-photos/farm1.jpg" });
    expect(create.status).toBe(201);
    const post = await prisma.feedPost.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

    const afterCreate = await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    expect((afterCreate._sum.amount ?? 0) - beforeTotal).toBe(10);

    const del = await request(app)
      .delete(`/api/community/feed/posts/${post!.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const afterDelete = await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    expect((afterDelete._sum.amount ?? 0) - beforeTotal).toBe(0);
  });

  it("apagar um post manual antigo (fora da janela) não estorna o XP retroativamente", async () => {
    const create = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ caption: "post antigo" });
    expect(create.status).toBe(201);
    const post = await prisma.feedPost.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

    // Força o post a parecer antigo (fora da janela de estorno de 10min).
    await prisma.feedPost.update({
      where: { id: post!.id },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) }
    });

    const before = await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    const beforeTotal = before._sum.amount ?? 0;

    const del = await request(app)
      .delete(`/api/community/feed/posts/${post!.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const after = await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    expect(after._sum.amount ?? 0).toBe(beforeTotal);
  });

  it("criar o mesmo post duas vezes seguidas não duplica XP (deduplicação por referenceId)", async () => {
    const before = await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    const beforeTotal = before._sum.amount ?? 0;

    await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ caption: "post 1", imageUrl: "https://fake-r2-public.test/feed-photos/farm2.jpg" });
    const post1 = await prisma.feedPost.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

    await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ caption: "post 2", imageUrl: "https://fake-r2-public.test/feed-photos/farm3.jpg" });
    const post2 = await prisma.feedPost.findFirst({
      where: { userId, id: { not: post1!.id } },
      orderBy: { createdAt: "desc" }
    });

    const after = await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    // 2 posts distintos (referenceId diferente) => 20 XP, não deduplicado entre si.
    expect((after._sum.amount ?? 0) - beforeTotal).toBe(20);
    expect(post1!.id).not.toBe(post2!.id);
  });
});
