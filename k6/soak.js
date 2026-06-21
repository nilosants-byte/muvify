/**
 * SOAK TEST — Muvify
 *
 * Objetivo: verificar estabilidade do servidor ao longo do tempo.
 * Detecta problemas que só aparecem após uso prolongado:
 *   - Memory leaks (RAM que nunca é liberada)
 *   - Conexões de banco de dados que não são fechadas
 *   - Filas que crescem sem parar
 *
 * Duração: 30 minutos a carga moderada.
 * Rodar 1–2 dias antes do lançamento, quando o servidor staging estiver estável.
 *
 * Executar:
 *   k6 run k6/soak.js -e BASE_URL=https://api-staging.muvify.com.br
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { login, authHeaders, BASE_URL } from "./helpers/auth.js";

export const options = {
  stages: [
    { duration: "2m",  target: 20 }, // Warm-up
    { duration: "26m", target: 20 }, // Carga estável por 26 minutos
    { duration: "2m",  target: 0 },  // Cool-down
  ],
  thresholds: {
    http_req_duration: ["p(95)<600", "p(99)<1500"],
    http_req_failed: ["rate<0.01"],
  },
};

const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || "qa.aluno@muvify.local";
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || "Qa123456";

export default function () {
  // Busca pública
  const search = http.get(`${BASE_URL}/api/providers?limit=10`, {
    headers: { "Content-Type": "application/json" },
  });
  check(search, { "search: 200": (r) => r.status === 200 });
  sleep(1);

  // Health (monitora que o banco não degradou)
  const health = http.get(`${BASE_URL}/health`);
  check(health, { "health: ok": (r) => r.status === 200 });
  sleep(1);

  // Fluxo autenticado a cada 3 iterações (simula taxa realista de login)
  if (Math.random() < 0.33) {
    const token = login(CLIENT_EMAIL, CLIENT_PASSWORD);
    if (token) {
      const me = http.get(`${BASE_URL}/api/users/me`, { headers: authHeaders(token) });
      check(me, { "users/me: 200": (r) => r.status === 200 });
      sleep(1);
    }
  }

  sleep(2 + Math.random() * 2);
}
