/**
 * LOAD TEST — Muvify
 *
 * Objetivo: simular uso real simultâneo. Detecta degradação de performance
 * em cenários realistas antes do lançamento.
 *
 * Cenários simulados:
 *   60% — clientes navegando e buscando profissionais (público)
 *   25% — clientes autenticados consultando agenda e bookings
 *   15% — profissionais verificando agenda e disponibilidade
 *
 * Perfil de carga:
 *   0–1 min   → sobe de 0 para 50 usuários (warm-up)
 *   1–4 min   → mantém 50 usuários (carga sustentada)
 *   4–5 min   → desce para 0 (cool-down)
 *
 * Executar:
 *   k6 run k6/load.js
 *   k6 run k6/load.js -e BASE_URL=https://api.muvify.com.br --out json=results/load.json
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { login, authHeaders, BASE_URL } from "./helpers/auth.js";

export const options = {
  scenarios: {
    // Clientes navegando sem login (maior volume)
    public_browsing: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 30 },
        { duration: "3m", target: 30 },
        { duration: "1m", target: 0 },
      ],
      exec: "publicBrowsing",
    },
    // Clientes autenticados
    authenticated_clients: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 12 },
        { duration: "3m", target: 12 },
        { duration: "1m", target: 0 },
      ],
      exec: "authenticatedClient",
    },
    // Profissionais verificando agenda
    professionals: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 8 },
        { duration: "3m", target: 8 },
        { duration: "1m", target: 0 },
      ],
      exec: "professionalSession",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1500"],
    http_req_failed: ["rate<0.01"],
    // Por cenário específico
    "http_req_duration{scenario:public_browsing}": ["p(95)<400"],
    "http_req_duration{scenario:authenticated_clients}": ["p(95)<600"],
  },
};

const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || "qa.aluno@muvify.local";
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || "Qa123456";
const PROFESSIONAL_EMAIL = __ENV.PROFESSIONAL_EMAIL || "qa.personal@muvify.local";
const PROFESSIONAL_PASSWORD = __ENV.PROFESSIONAL_PASSWORD || "Qa123456";

// ── Cenário 1: Navegação pública ─────────────────────────────────────────────

export function publicBrowsing() {
  // Busca por profissionais
  const search = http.get(
    `${BASE_URL}/api/providers?limit=10&page=1`,
    { headers: { "Content-Type": "application/json" } }
  );
  check(search, { "search: 200": (r) => r.status === 200 });
  sleep(1 + Math.random() * 2); // usuário demora para ler os resultados

  // Abre perfil de um profissional (se a busca retornou algum)
  try {
    const providers = search.json();
    if (Array.isArray(providers) && providers.length > 0) {
      const provider = providers[Math.floor(Math.random() * providers.length)];
      if (provider?.id) {
        const profile = http.get(
          `${BASE_URL}/api/providers/${provider.id}`,
          { headers: { "Content-Type": "application/json" } }
        );
        check(profile, { "provider profile: 200": (r) => r.status === 200 });
        sleep(2 + Math.random() * 3); // usuário lê o perfil
      }
    }
  } catch {
    // ignora parse errors
  }

  sleep(1);
}

// ── Cenário 2: Cliente autenticado ────────────────────────────────────────────

export function authenticatedClient() {
  const token = login(CLIENT_EMAIL, CLIENT_PASSWORD);
  if (!token) { sleep(5); return; }

  const headers = authHeaders(token);

  // Verifica agendamentos
  const bookings = http.get(`${BASE_URL}/api/bookings/me`, { headers });
  check(bookings, { "bookings/me: 200": (r) => r.status === 200 });
  sleep(1);

  // Verifica perfil
  const me = http.get(`${BASE_URL}/api/users/me`, { headers });
  check(me, { "users/me: 200": (r) => r.status === 200 });
  sleep(2 + Math.random() * 2);
}

// ── Cenário 3: Profissional verificando agenda ────────────────────────────────

export function professionalSession() {
  const token = login(PROFESSIONAL_EMAIL, PROFESSIONAL_PASSWORD);
  if (!token) { sleep(5); return; }

  const headers = authHeaders(token);

  // Verifica disponibilidade
  const avail = http.get(`${BASE_URL}/api/availability/me`, { headers });
  check(avail, { "availability/me: 200": (r) => r.status === 200 });
  sleep(1);

  // Verifica bookings como profissional
  const bookings = http.get(`${BASE_URL}/api/bookings/me`, { headers });
  check(bookings, { "bookings/me (prof): 200": (r) => r.status === 200 });
  sleep(1);

  // Verifica notificações
  const notifs = http.get(`${BASE_URL}/api/notifications`, { headers });
  check(notifs, { "notifications: 200": (r) => r.status === 200 });
  sleep(3 + Math.random() * 2);
}
