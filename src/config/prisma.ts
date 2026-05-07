import { PrismaClient } from "@prisma/client";

function buildDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? "";
  try {
    const url = new URL(base);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "20");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "20");
    }
    return url.toString();
  } catch {
    return base;
  }
}

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  datasources: { db: { url: buildDatabaseUrl() } },
});
