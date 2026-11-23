import express from "express";
import rateLimit, { MemoryStore, type IncrementResponse, type Store } from "express-rate-limit";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ResilientRateLimitStore } from "../src/middlewares/resilient-rate-limit-store";
import { BootSafeRedisStore } from "../src/middlewares/rate-limit.middleware";

// Simula o Redis: ou responde normalmente (contando em memória), ou falha em
// todo comando, como quando a conexão cai.
class FakeRedisStore implements Store {
  prefix = "rl:test:";
  failing = false;
  calls = 0;
  private readonly inner = new MemoryStore();

  init(options: Parameters<MemoryStore["init"]>[0]) {
    this.inner.init(options);
  }

  increment(key: string): Promise<IncrementResponse> {
    this.calls += 1;
    if (this.failing) return Promise.reject(new Error("Connection is closed."));
    return this.inner.increment(key);
  }

  async decrement(key: string) {
    if (this.failing) throw new Error("Connection is closed.");
    this.inner.decrement(key);
  }

  async resetKey(key: string) {
    if (this.failing) throw new Error("Connection is closed.");
    this.inner.resetKey(key);
  }
}

function appWith(store: Store) {
  const app = express();
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      passOnStoreError: true,
      store
    })
  );
  app.get("/", (_req, res) => res.json({ ok: true }));
  return app;
}

async function statuses(app: express.Express, count: number) {
  const result: number[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push((await request(app).get("/")).status);
  }
  return result;
}

describe("limite de tentativas com o Redis fora do ar", () => {
  it("antes: com o Redis puro e passOnStoreError, o limite sumia", async () => {
    const redis = new FakeRedisStore();
    redis.failing = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await statuses(appWith(redis), 6)).toEqual([200, 200, 200, 200, 200, 200]);
    vi.restoreAllMocks();
  });

  it("Redis respondendo: conta no Redis", async () => {
    const redis = new FakeRedisStore();
    const store = new ResilientRateLimitStore(redis, () => true);

    expect(await statuses(appWith(store), 4)).toEqual([200, 200, 200, 429]);
    expect(redis.calls).toBe(4);
    store.shutdown();
  });

  it("Redis fora do ar: continua limitando, sem nem tentar o Redis", async () => {
    const redis = new FakeRedisStore();
    redis.failing = true;
    const store = new ResilientRateLimitStore(redis, () => false);

    expect(await statuses(appWith(store), 5)).toEqual([200, 200, 200, 429, 429]);
    expect(redis.calls).toBe(0);
    store.shutdown();
  });

  it("Redis 'pronto' mas o comando falha: continua limitando e reporta uma vez só", async () => {
    const redis = new FakeRedisStore();
    redis.failing = true;
    const store = new ResilientRateLimitStore(redis, () => true);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await statuses(appWith(store), 5)).toEqual([200, 200, 200, 429, 429]);
    expect(log.mock.calls.filter(([msg]) => String(msg).includes("[rate-limit]"))).toHaveLength(1);
    vi.restoreAllMocks();
    store.shutdown();
  });

  // Sem a correção, a preparação dos scripts no construtor rejeitava sem
  // dono: o Vitest reprova a rodada inteira por "Unhandled Rejection", e o
  // server.ts desligava o processo.
  it("Redis fora do ar na hora de ligar: não deixa erro sem tratamento", async () => {
    const offline = () => Promise.reject(new Error("Reached the max retries per request limit"));
    const redisStore = new BootSafeRedisStore({ prefix: "rl:boot:", sendCommand: offline });
    const store = new ResilientRateLimitStore(redisStore, () => false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await statuses(appWith(store), 4)).toEqual([200, 200, 200, 429]);
    // Quem usa o script de fato continua recebendo o erro.
    await expect(redisStore.increment("x")).rejects.toThrow();
    store.shutdown();
  });
});
