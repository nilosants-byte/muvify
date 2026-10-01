import { Client } from "pg";
import { env } from "../../config/env";

// Achado em teste manual (2026-09-30): os jobs em background usavam
// pg_try_advisory_lock/pg_advisory_unlock como duas chamadas separadas
// (prisma.$queryRaw e prisma.$executeRaw), fora de uma transação. Lock
// consultivo de SESSÃO do Postgres é preso à conexão física, não ao
// PrismaClient lógico — e o banco de produção/staging fica atrás do
// pooler da Supabase (PgBouncer em modo "transaction"), que só garante a
// MESMA conexão física por trás de um client enquanto houver uma
// transação SQL explícita aberta; fora disso, cada statement pode ir pra
// um backend diferente. Resultado: o unlock, quando caía num backend
// diferente do lock, não tinha efeito nenhum (libera um lock que aquele
// backend nunca tinha) — o lock ficava órfão pra sempre, travando aquele
// job silenciosamente até o processo inteiro reiniciar. Confirmado em
// produção: 4 dos 7 jobs que usavam esse padrão estavam com o lock preso
// dessa forma ao mesmo tempo (incluindo o de e-mail, sintoma que expôs o
// problema).
//
// Correção: pg_try_advisory_xact_lock (preso à TRANSAÇÃO, não à sessão)
// dentro de um BEGIN/COMMIT explícito numa conexão dedicada (fora do pool
// do Prisma, via `pg`). O BEGIN força o PgBouncer a fixar a mesma conexão
// física até o COMMIT/ROLLBACK, e o lock libera sozinho nesse momento —
// sem precisar de um unlock manual que possa calhar na conexão errada.
// Validado manualmente contra o Postgres real de staging (Supabase
// pooler): exclusão mútua concorrente funciona e o lock libera
// corretamente ao final. Conexão dedicada (não prisma.$transaction) para
// não herdar o timeout padrão de transação do Prisma — alguns destes jobs
// legitimamente podem demorar mais que isso (payment-jobs.ts soma até 13
// sub-tarefas com até 5min cada).
export async function withJobLock(lockKey: number, fn: () => Promise<void>): Promise<boolean> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
      [lockKey]
    );
    const locked = Boolean(result.rows[0]?.locked);
    if (!locked) {
      await client.query("ROLLBACK");
      return false;
    }
    try {
      await fn();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        // melhor esforço - a conexão será fechada de qualquer forma logo abaixo
      });
      throw error;
    }
    return true;
  } finally {
    await client.end();
  }
}
