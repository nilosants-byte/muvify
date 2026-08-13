import { Request, Response, NextFunction } from "express";
import client from "prom-client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";

// Exportado pra dar pra ler o texto do registro direto em teste, sem
// precisar montar toda a autenticação de /metrics (ver metricsHandler).
export const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duracao das requisicoes HTTP em segundos",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

// Frente 13 (segunda camada), Lote 6: até aqui, a única métrica exposta era
// HTTP genérico — nenhuma visibilidade de negócio (job periódico atrasado,
// fila de e-mail acumulando, erro de operação de pagamento). Essas taxas só
// apareciam se alguém abrisse o Sentry manualmente (e olhasse achado por
// achado, sem nenhum agregado).
export const jobLastSuccessTimestamp = new client.Gauge({
  name: "job_last_success_timestamp_seconds",
  help: "Timestamp unix (segundos) da ultima vez que um job periodico (ou sub-job) terminou sem erro",
  labelNames: ["job"],
  registers: [register]
});

export const jobRunTotal = new client.Counter({
  name: "job_run_total",
  help: "Total de execucoes de job periodico (ou sub-job), por resultado",
  labelNames: ["job", "result"],
  registers: [register]
});

export function recordJobSuccess(job: string) {
  jobLastSuccessTimestamp.set({ job }, Date.now() / 1000);
  jobRunTotal.inc({ job, result: "success" });
}

export function recordJobFailure(job: string) {
  jobRunTotal.inc({ job, result: "failure" });
}

export const paymentOperationTotal = new client.Counter({
  name: "payment_operation_total",
  help: "Total de operacoes financeiras criticas (autorizacao, captura, renovacao de token MP), por resultado",
  labelNames: ["operation", "result"],
  registers: [register]
});

// Gauge com collect() assincrono: recalculado a cada scrape do /metrics,
// nao precisa de nenhum job dedicado so pra manter esse numero atualizado.
new client.Gauge({
  name: "email_queue_pending",
  help: "Itens na fila de e-mail ainda tentando entregar (nao esgotaram as tentativas)",
  registers: [register],
  async collect() {
    const count = await prisma.emailDeliveryQueue.count({ where: { failedAt: null } });
    this.set(count);
  }
});

new client.Gauge({
  name: "email_queue_failed_pending_purge",
  help: "Itens na fila de e-mail que esgotaram as tentativas e ainda nao foram expurgados (30 dias)",
  registers: [register],
  async collect() {
    const count = await prisma.emailDeliveryQueue.count({ where: { failedAt: { not: null } } });
    this.set(count);
  }
});

// Frente 13 (segunda camada), Lote 7: /health já é sólido de verdade (roda
// SELECT 1 no Postgres e PING no Redis, não só responde 200 sempre) — mas
// nada na stack de monitoramento (Prometheus só faz scrape de /metrics)
// jamais chamava /health. Uma degradação real de banco/Redis só derrubava
// o healthcheck local do Docker, sem gerar nenhum alerta via
// Alertmanager/Slack. Reaproveita a mesma checagem aqui, como parte do
// scrape normal de /metrics.
new client.Gauge({
  name: "app_database_up",
  help: "1 se o SELECT 1 no Postgres respondeu no momento do scrape, 0 caso contrario",
  registers: [register],
  async collect() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      this.set(1);
    } catch {
      this.set(0);
    }
  }
});

new client.Gauge({
  name: "app_redis_up",
  help: "1 se o PING no Redis respondeu no momento do scrape, 0 caso contrario",
  registers: [register],
  async collect() {
    try {
      if (redis.status !== "ready") {
        this.set(0);
        return;
      }
      await redis.ping();
      this.set(1);
    } catch {
      this.set(0);
    }
  }
});

function resolveRoute(request: Request) {
  if (request.route?.path) {
    return `${request.baseUrl || ""}${request.route.path}`;
  }
  return "unknown";
}

export function metricsMiddleware(request: Request, response: Response, next: NextFunction) {
  const end = httpRequestDuration.startTimer();
  response.on("finish", () => {
    end({
      method: request.method,
      route: resolveRoute(request),
      status_code: response.statusCode
    });
  });
  next();
}

export async function metricsHandler(request: Request, response: Response) {
  if (!env.METRICS_TOKEN) {
    response.status(503).json({ message: "Metrics not available." });
    return;
  }
  const authHeader = request.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== env.METRICS_TOKEN) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }
  response.setHeader("Content-Type", register.contentType);
  response.end(await register.metrics());
}
