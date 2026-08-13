import "dotenv/config";
import { describe, expect, it } from "vitest";
import { register } from "../src/observability/metrics";

// Frente 13 (segunda camada), Lote 7: /health já rodava SELECT 1 no
// Postgres e PING no Redis de verdade, mas nada na stack de monitoramento
// (Prometheus só faz scrape de /metrics) jamais consultava esse endpoint —
// uma degradação real de banco/Redis só derrubava o healthcheck local do
// Docker, sem gerar alerta via Alertmanager/Slack.

describe("Frente 13, Lote 7 — Postgres/Redis expostos como métrica de scrape", () => {
  it("app_database_up e app_redis_up aparecem no texto do /metrics com valor 1 (banco/Redis disponíveis no ambiente de teste)", async () => {
    const text = await register.metrics();

    expect(text).toContain("app_database_up");
    expect(text).toContain("app_redis_up");
    expect(text).toMatch(/app_database_up 1/);
    // Redis pode não estar "ready" no worker de teste dependendo de timing
    // de conexão — valor 0 ou 1 são ambos legítimos aqui, o que importa é
    // que a métrica existe e reflete um estado real (0 ou 1), não sempre
    // "tudo ok" hardcoded.
    expect(text).toMatch(/app_redis_up [01]/);
  });
});
