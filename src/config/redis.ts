import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    // Backoff exponencial: 100ms → 200ms → 400ms … até 5s
    const delay = Math.min(100 * 2 ** (times - 1), 5000);
    return delay;
  },
});

let connectPromise: Promise<void> | null = null;

function isRedisConnectionInProgressOrReady() {
  return (
    redis.status === "ready" ||
    redis.status === "connecting" ||
    redis.status === "connect" ||
    redis.status === "reconnecting"
  );
}

export async function connectRedis() {
  if (isRedisConnectionInProgressOrReady()) {
    if (connectPromise) {
      await connectPromise;
    }
    return;
  }

  connectPromise = redis
    .connect()
    .catch((error) => {
      console.error("Redis connection failed:", error);
    })
    .finally(() => {
      connectPromise = null;
    });

  await connectPromise;

  // ioredis emits "ready" slightly after connect() resolves.
  // Wait up to 3 s to confirm the connection is fully usable before
  // the app starts serving requests.
  if (redis.status !== "ready") {
    await new Promise<void>((resolve) => {
      const onReady = () => {
        redis.off("error", onError);
        resolve();
      };
      const onError = () => {
        redis.off("ready", onReady);
        resolve(); // degrade gracefully — app works without cache
      };
      redis.once("ready", onReady);
      redis.once("error", onError);
      setTimeout(() => {
        redis.off("ready", onReady);
        redis.off("error", onError);
        resolve();
      }, 3000);
    });
  }
}
