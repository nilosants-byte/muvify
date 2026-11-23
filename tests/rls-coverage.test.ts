import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";

describe("Cobertura de RLS", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("toda tabela do schema public tem Row Level Security ligado", async () => {
    const semRls = await prisma.$queryRaw<Array<{ tabela: string }>>`
      SELECT c.relname::text AS tabela
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p')
        AND NOT c.relrowsecurity
      ORDER BY 1`;

    expect(semRls.map((linha) => linha.tabela)).toEqual([]);
  });
});
