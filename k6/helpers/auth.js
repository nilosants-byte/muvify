import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

/**
 * Faz login e retorna o accessToken.
 * Retorna null se falhar (o teste continua, mas requests autenticados serão pulados).
 */
export function login(email, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } }
  );

  const ok = check(res, {
    "login: status 200": (r) => r.status === 200,
    "login: tem accessToken": (r) => {
      try { return Boolean(r.json("accessToken")); } catch { return false; }
    },
  });

  if (!ok) return null;
  return res.json("accessToken");
}

/**
 * Headers JSON autenticados para uso nos requests.
 */
export function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export { BASE_URL };
