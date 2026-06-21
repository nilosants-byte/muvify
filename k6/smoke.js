/**
 * SMOKE TEST — Muvify
 *
 * Objetivo: verificar que os endpoints principais respondem corretamente.
 * Uso: roda antes de qualquer deploy para detectar regressões graves.
 * Duração: ~30 segundos, 3 usuários virtuais.
 *
 * Executar:
 *   k6 run k6/smoke.js
 *   k6 run k6/smoke.js -e BASE_URL=https://api.muvify.com.br
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { login, authHeaders, BASE_URL } from "./helpers/auth.js";

export const options = {
  vus: 3,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || "qa.aluno@muvify.local";
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || "Qa123456";

export default function () {
  // 1. Health check
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    "health: status 200": (r) => r.status === 200,
    "health: database ok": (r) => {
      try { return r.json("status") === "ok"; } catch { return false; }
    },
  });

  sleep(0.5);

  // 2. Busca de profissionais (endpoint público mais importante)
  const search = http.get(`${BASE_URL}/api/providers?limit=10`, {
    headers: { "Content-Type": "application/json" },
  });
  check(search, {
    "providers/search: status 200": (r) => r.status === 200,
    "providers/search: retorna array": (r) => {
      try { return Array.isArray(r.json()); } catch { return false; }
    },
  });

  sleep(0.5);

  // 3. Login de cliente
  const token = login(CLIENT_EMAIL, CLIENT_PASSWORD);
  if (!token) return;

  sleep(0.5);

  // 4. Perfil do usuário autenticado
  const me = http.get(`${BASE_URL}/api/users/me`, {
    headers: authHeaders(token),
  });
  check(me, {
    "users/me: status 200": (r) => r.status === 200,
    "users/me: tem id": (r) => {
      try { return Boolean(r.json("id")); } catch { return false; }
    },
  });

  sleep(0.5);

  // 5. Agendamentos do usuário
  const bookings = http.get(`${BASE_URL}/api/bookings/me`, {
    headers: authHeaders(token),
  });
  check(bookings, {
    "bookings/me: status 200": (r) => r.status === 200,
  });

  sleep(1);
}
