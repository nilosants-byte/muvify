import { describe, it, expect } from "vitest";
import { followingListSchema, paginationSchema } from "../src/modules/community/validators/community.validator";

// Teste manual C11.1 (22/10/2026): o app pede quem o usuário segue com
// limit=200; o teto era 50 e a chamada era recusada — o app concluía que o
// usuário não seguia ninguém (perfil do amigo mostrava "Seguir").
describe("lista de quem o usuário segue", () => {
  it("aceita limit=200 (o que o app pede)", () => {
    expect(followingListSchema.safeParse({ query: { page: "1", limit: "200" } }).success).toBe(true);
  });
  it("continua recusando acima de 200", () => {
    expect(followingListSchema.safeParse({ query: { page: "1", limit: "201" } }).success).toBe(false);
  });
  it("demais listas continuam com teto 50", () => {
    expect(paginationSchema.safeParse({ query: { page: "1", limit: "200" } }).success).toBe(false);
  });
});
