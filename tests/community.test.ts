import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const PASSWORD = "Test1234";
let tokenA = "";
let userAId = "";
let tokenB = "";
let userBId = "";
let postId = "";
let commentId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("community", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const emailA = `${uid("comm_a")}@test.com`;
    const phoneA = `113${Date.now().toString().slice(-9)}`;
    const regA = await request(app).post("/api/auth/register").send({
      name: "Community A",
      email: emailA,
      password: PASSWORD,
      phone: phoneA,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const emailB = `${uid("comm_b")}@test.com`;
    const phoneB = `114${Date.now().toString().slice(-9)}`;
    const regB = await request(app).post("/api/auth/register").send({
      name: "Community B",
      email: emailB,
      password: PASSWORD,
      phone: phoneB,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    tokenB = regB.body.accessToken;
    userBId = regB.body.user.id;
  });

  afterAll(async () => {
    const posts = await prisma.feedPost.findMany({
      where: { userId: { in: [userAId, userBId] } },
      select: { id: true },
    });
    const postIds = posts.map((p) => p.id);
    if (postIds.length > 0) {
      await prisma.feedPostComment.deleteMany({ where: { postId: { in: postIds } } });
      await prisma.feedPostLike.deleteMany({ where: { postId: { in: postIds } } });
      await prisma.feedPost.deleteMany({ where: { id: { in: postIds } } });
    }
    await prisma.follow.deleteMany({
      where: {
        OR: [{ followerId: { in: [userAId, userBId] } }, { followingId: { in: [userAId, userBId] } }],
      },
    });
    await prisma.session.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
  });

  // ── Follow ────────────────────────────────────────────────────────────────
  it("POST /community/follow/:userId follows another user", async () => {
    const res = await request(app)
      .post(`/api/community/follow/${userBId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(204);
  });

  // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: curtir/comentar
  // agora respeita a visibilidade do feed (curtir/comentar exige que o
  // autor seja o próprio usuário ou alguém que ele segue) — B precisa
  // seguir A pra poder interagir com os posts de A mais abaixo.
  it("POST /community/follow/:userId (B follows A, needed for B to interact with A's posts)", async () => {
    const res = await request(app)
      .post(`/api/community/follow/${userAId}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(204);
  });

  it("GET /community/following lists users A is following", async () => {
    const res = await request(app)
      .get("/api/community/following")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  it("GET /community/followers lists followers of B", async () => {
    const res = await request(app)
      .get("/api/community/followers")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
  });

  it("rejects following yourself", async () => {
    const res = await request(app)
      .post(`/api/community/follow/${userAId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(422);
  });

  // ── User profile and search ───────────────────────────────────────────────
  it("GET /community/users/:userId returns user profile", async () => {
    const res = await request(app)
      .get(`/api/community/users/${userBId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  it("GET /community/users/search returns results", async () => {
    const res = await request(app)
      .get("/api/community/users/search?q=Community")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  it("GET /community/suggestions returns list", async () => {
    const res = await request(app)
      .get("/api/community/suggestions")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  // ── Feed posts ────────────────────────────────────────────────────────────
  it("POST /community/feed/posts creates post with caption", async () => {
    const res = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ caption: "Treino concluído!" });
    expect(res.status).toBe(201);

    // The endpoint responds with an empty body; fetch the created post's id directly.
    const post = await prisma.feedPost.findFirst({
      where: { userId: userAId },
      orderBy: { createdAt: "desc" },
    });
    postId = post!.id;
  });

  it("POST /community/feed/posts rejects empty body", async () => {
    const res = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("GET /community/feed returns feed", async () => {
    const res = await request(app)
      .get("/api/community/feed")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  // ── Likes ─────────────────────────────────────────────────────────────────
  it("POST /community/feed/posts/:postId/like likes a post", async () => {
    const res = await request(app)
      .post(`/api/community/feed/posts/${postId}/like`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect([200, 201]).toContain(res.status);
  });

  // ── Comments ──────────────────────────────────────────────────────────────
  it("POST /community/feed/posts/:postId/comments adds comment", async () => {
    const res = await request(app)
      .post(`/api/community/feed/posts/${postId}/comments`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ content: "Parabéns!" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    commentId = res.body.id;
  });

  it("GET /community/feed/posts/:postId/comments lists comments", async () => {
    const res = await request(app)
      .get(`/api/community/feed/posts/${postId}/comments`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  it("PATCH /community/feed/posts/:postId/comments/:commentId edits own comment", async () => {
    const res = await request(app)
      .patch(`/api/community/feed/posts/${postId}/comments/${commentId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ content: "Muito bom!" });
    expect(res.status).toBe(200);
  });

  it("cannot edit another user's comment", async () => {
    const res = await request(app)
      .patch(`/api/community/feed/posts/${postId}/comments/${commentId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ content: "Editando comentário alheio" });
    expect([403, 404]).toContain(res.status);
  });

  it("DELETE /community/feed/posts/:postId/comments/:commentId removes comment", async () => {
    const res = await request(app)
      .delete(`/api/community/feed/posts/${postId}/comments/${commentId}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(204);
  });

  // ── Ranking ───────────────────────────────────────────────────────────────
  it("GET /community/ranking returns ranking", async () => {
    const res = await request(app)
      .get("/api/community/ranking")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  it("GET /community/ranking?period=MONTHLY works", async () => {
    const res = await request(app)
      .get("/api/community/ranking?period=MONTHLY")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  // ── Unfollow ──────────────────────────────────────────────────────────────
  it("DELETE /community/follow/:userId unfollows user", async () => {
    const res = await request(app)
      .delete(`/api/community/follow/${userBId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(204);
  });

  // ── Delete post ───────────────────────────────────────────────────────────
  it("DELETE /community/feed/posts/:postId removes own post", async () => {
    const res = await request(app)
      .delete(`/api/community/feed/posts/${postId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(204);
  });

  it("cannot delete another user's post", async () => {
    const createRes = await request(app)
      .post("/api/community/feed/posts")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ caption: "Post do B" });
    expect(createRes.status).toBe(201);
    const bPost = await prisma.feedPost.findFirst({
      where: { userId: userBId },
      orderBy: { createdAt: "desc" },
    });
    const bPostId = bPost!.id;

    const deleteRes = await request(app)
      .delete(`/api/community/feed/posts/${bPostId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect([403, 404]).toContain(deleteRes.status);

    // cleanup
    await request(app)
      .delete(`/api/community/feed/posts/${bPostId}`)
      .set("Authorization", `Bearer ${tokenB}`);
  });

  // ── Auth guard ────────────────────────────────────────────────────────────
  it("rejects unauthenticated access to feed", async () => {
    const res = await request(app).get("/api/community/feed");
    expect(res.status).toBe(401);
  });
});
