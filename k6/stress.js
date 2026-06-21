/**
 * STRESS TEST — Muvify
 *
 * Objetivo: descobrir até quantos usuários simultâneos o servidor aguenta
 * antes de começar a degradar ou retornar erros.
 *
 * Interprete os resultados:
 *   - Quando p95 começa a subir acima de 1s → servidor está sobrecarregado
 *   - Quando error rate sobe acima de 1% → limite foi atingido
 *   - O VU count nesse momento é a capacidade máxima atual
 *
 * Executar:
 *   k6 run k6/stress.js
 *   k6 run k6/stress.js -e BASE_URL=https://api-staging.muvify.com.br
 *
 * ATENÇÃO: não rodar em produção com usuários reais.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { login, authHeaders, BASE_URL } from "./helpers/auth.js";

export const options = {
  stages: [
    { duration: "1m", target: 20 },   // Warm-up lento
    { duration: "2m", target: 50 },   // Carga normal esperada
    { duration: "2m", target: 100 },  // Pressão elevada
    { duration: "2m", target: 200 },  // Stress: 2x do esperado
    { duration: "2m", target: 300 },  // Stress extremo
    { duration: "1m", target: 0 },    // Cool-down
  ],
  // Thresholds mais permissivos — queremos ver onde quebra, não abortar cedo
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.15"],
  },
};

const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || "qa.aluno@muvify.local";
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || "Qa123456";

export default function () {
  // Foca no endpoint mais pesado: busca de profissionais
  const search = http.get(`${BASE_URL}/api/providers?limit=10`, {
    headers: { "Content-Type": "application/json" },
  });

  check(search, {
    "search: 200": (r) => r.status === 200,
    "search: < 1s": (r) => r.timings.duration < 1000,
  });

  sleep(0.5);

  // Health check — deve sempre responder mesmo sob stress
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    "health: sempre 200": (r) => r.status === 200,
    "health: < 200ms": (r) => r.timings.duration < 200,
  });

  sleep(0.5 + Math.random());
}
