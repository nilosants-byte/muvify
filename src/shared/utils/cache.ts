import { redis } from "../../config/redis";

export async function getCache<T>(key: string) {
  if (redis.status !== "ready") {
    return null;
  }
  const value = await redis.get(key);
  return value ? (JSON.parse(value) as T) : null;
}

export async function setCache(key: string, value: unknown, ttlSeconds = 300) {
  if (redis.status !== "ready") {
    return;
  }
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    console.warn("[cache] setCache failed for key:", key, error);
  }
}

export async function deleteByPattern(pattern: string) {
  if (redis.status !== "ready") {
    return;
  }
  let cursor = "0";
  const keys: string[] = [];
  let iterations = 0;
  const MAX_ITERATIONS = 50; // safety cap: 50 × COUNT 200 = up to 10 000 keys max
  do {
    const [nextCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = nextCursor;
    if (batch.length > 0) {
      keys.push(...batch);
    }
    iterations++;
  } while (cursor !== "0" && iterations < MAX_ITERATIONS);

  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
