#!/bin/sh
set -e

# Frente 13 (segunda camada), Lote 3: o arquivo estático monitoring/prometheus.yml
# tinha "authorization: credentials: METRICS_TOKEN" comentado, e mesmo
# descomentado não teria efeito — Prometheus não faz interpolação de
# variável de ambiente em arquivo de config estático (diferente do
# entrypoint.sh do alertmanager, que já gera o config real via heredoc de
# shell). Sem o token certo, todo scrape de /metrics batia em 401/503,
# up{job="app"}==0 ficava permanente, o alerta AppDown disparava sempre —
# e o time aprendia a ignorá-lo, mascarando os alertas que importam de
# verdade (HighErrorRate, HighLatencyP95). Mesmo padrão do alertmanager:
# gera o config de verdade no boot do container, com a variável de
# ambiente já resolvida.

CONFIG=/etc/prometheus/prometheus.yml

cat > "$CONFIG" <<YAML
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/alerts.yml

scrape_configs:
  - job_name: "app"
    metrics_path: /metrics
    authorization:
      credentials: "${METRICS_TOKEN}"
    static_configs:
      - targets:
          - "app:3000"
          - "host.docker.internal:3000"
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
YAML

exec /bin/prometheus --config.file="$CONFIG"
