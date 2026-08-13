import { PrismaClient } from "@prisma/client";

function buildDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? "";
  try {
    const url = new URL(base);
    if (!url.searchParams.has("connection_limit")) {
      // Frente 12 (segunda camada), Lote 3: em teste, cada worker do Vitest
      // (até 8 threads nesta máquina) carrega seu próprio PrismaClient —
      // 20 conexões cada podia somar até 160 pedidas contra um Postgres de
      // teste com max_connections=100 (default do postgres:16-alpine,
      // nenhum override em docker-compose.test.yml). A primeira tentativa
      // (5 por worker × 8 = 40) foi longe demais pro outro lado: sob a
      // suíte inteira, um único worker rodando vários testes concorrentes
      // que usam pg_advisory_xact_lock passou a fila de conexões tão
      // apertada que a própria transação (já com o timeout de 15s do Lote
      // 2) estourava por espera de conexão, não por trabalho de verdade
      // ("Transaction already closed... 22709 ms passed" com limite de
      // 5) — regressão pior que o problema original. 12 por worker × 8 =
      // 96, ainda com folga confortável sob max_connections=100, mas sem
      // reintroduzir aquele gargalo. Produção continua com 20 (processo
      // único).
      // Frente 14 (segunda camada, carga real), Lote 6: 20 é POR PROCESSO,
      // não um teto compartilhado — se a operação um dia decidir escalar o
      // backend pra N réplicas (ver docker-compose.prod.yml/Dockerfile,
      // hoje instância única), cada uma abre até 20 conexões próprias e o
      // total pedido ao Postgres vira até 20×N, sem nenhuma validação
      // automática de que o plano de hosting real suporta esse total. Ao
      // introduzir múltiplas réplicas, revisar este número (e o
      // max_connections do Postgres) antes, não depois.
      const fallback = process.env.NODE_ENV === "test" ? "12" : "20";
      url.searchParams.set("connection_limit", fallback);
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "20");
    }
    return url.toString();
  } catch {
    return base;
  }
}

// Frente 12 (segunda camada), Lote 2: o default do Prisma pra
// $transaction (5000ms) já se provou insuficiente sob a suíte de testes
// inteira rodando em paralelo numa máquina/CI sob carga ("Transaction
// already closed... timeout for this transaction was 5000 ms, however
// 5311/5778 ms passed"). Escopo só em teste, de propósito — não é uma
// mudança de comportamento de produção (uma transação que hoje estoura em
// 5s sob carga real continua estourando em 5s; só o ambiente de teste,
// onde o gargalo é a máquina de CI/dev e não um problema de produto, ganha
// folga).
const transactionOptions =
  process.env.NODE_ENV === "test" ? { timeout: 15_000 } : undefined;

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  datasources: { db: { url: buildDatabaseUrl() } },
  transactionOptions,
});
