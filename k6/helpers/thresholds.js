/**
 * Thresholds de performance padrão para todos os testes.
 *
 * p95 < 500ms  → 95% das requisições abaixo de 500ms (boa experiência mobile)
 * p99 < 1500ms → 99% abaixo de 1,5s (nenhum usuário espera muito)
 * error < 1%   → menos de 1% de falhas
 */
export const DEFAULT_THRESHOLDS = {
  http_req_duration: ["p(95)<500", "p(99)<1500"],
  http_req_failed: ["rate<0.01"],
};

/**
 * Thresholds mais tolerantes para testes de stress
 * (queremos ver onde quebra, não falhar cedo).
 */
export const STRESS_THRESHOLDS = {
  http_req_duration: ["p(95)<2000", "p(99)<5000"],
  http_req_failed: ["rate<0.10"],
};

/**
 * Verifica se um response HTTP está OK e loga falhas.
 */
export function checkResponse(res, label) {
  const { check } = require("k6");
  return check(res, {
    [`${label}: status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${label}: < 500ms`]: (r) => r.timings.duration < 500,
  });
}
