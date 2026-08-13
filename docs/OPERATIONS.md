# Operacoes
## Playbooks principais
1. Checklist de release: `docs/RELEASE-READINESS-CHECKLIST.md`.
2. Runbook de incidentes: `docs/INCIDENT-RUNBOOK.md`.
3. QA automatizado consolidado: `docs/QA-E2E-CHECKLIST.md`.

## Gate de release
Comandos oficiais:
1. `npm run release:gate` (lint + testes + preflight estrito).
2. `npm run release:gate:full` (qa:full + preflight estrito).
3. `npm run release:preflight -- --target=production` (checagem de configuracao e conectividade).

Interpretacao de `GET /health`:
1. `readiness=ready`: instancia apta a receber trafego.
2. `readiness=not_ready`: remover do balanceador ate normalizar.
3. `status=degraded` com `readiness=ready`: dependencia opcional degradada (ex.: Redis em modo nao estrito).

## Backup automatico
Cenarios recomendados para backup automatico:
1. Antes de operacoes destrutivas (`db:reset` e `db:restore`).
2. Antes de deploys ou migrations em producao.
3. Backup periodico (diario) para recuperacao de incidentes e erros operacionais.
4. Antes de cargas/importacoes em lote.

Para agendar backups no servidor, rode o scheduler em segundo plano:
1. Configure `BACKUP_SCHEDULE_INTERVAL_MINUTES` e `BACKUP_ON_START` no `.env`.
2. Execute `npm run db:backup:schedule` via service/cron/Task Scheduler.
3. Use `BACKUP_SCHEDULE_LOCK_TIMEOUT_MINUTES` para evitar backups concorrentes.
4. Opcional: `DB_BACKUP_BEFORE_RESTORE=false` desativa o backup automatico antes do restore.

## Backup offsite
1. Configure as variaveis `BACKUP_OFFSITE_PROVIDER`, `BACKUP_S3_BUCKET`, `AWS_REGION`.
2. Programe um cron no servidor para executar `npm run db:backup`.
3. Garanta politicas de retencao no bucket e acesso restrito.

## Verificacao de restore
1. Defina `BACKUP_VERIFY_DATABASE_URL` para um banco exclusivo de verificacao.
2. Programe um cron semanal para `npm run db:backup:verify`.
3. Valide logs e alertas se houver falha.

## Deploy
- Mantenha ambientes `staging` e `production` separados no GitHub Environments.
- Atualize `.env` do servidor antes de cada deploy.
- Use `docker compose -f docker-compose.prod.yml up -d` para atualizacoes locais.
- Configure `SMOKE_BASE_URL` e, se necessario, `SMOKE_ADMIN_EMAIL`/`SMOKE_ADMIN_PASSWORD` para o smoke test pos-deploy
  (`.github/workflows/smoke.yml`) — sem essa secret configurada, o job de smoke roda mas pula o teste real sem falhar
  (o step avisa isso explicitamente no log).
- Antes de aplicar uma migration em tabela com volume real de producao, ou de escalar para multiplas replicas,
  revise `docs/CARGA-REAL-GUIA-E-GAPS.md`.
- Para validar capacidade antes de um release grande, dispare `.github/workflows/load-test.yml` manualmente
  (`workflow_dispatch`) com o cenario k6 desejado (`smoke`/`load`/`stress`/`soak`) contra o ambiente indicado.
## Alertas
- Para Slack, configure `ALERT_SLACK_WEBHOOK` e `ALERT_SLACK_CHANNEL`.
- Para webhook generico, configure `ALERT_WEBHOOK_URL`.
- Para email, configure `ALERT_EMAIL_*` e `ALERT_SMTP_*`.
- O Alertmanager habilita automaticamente os canais configurados.

## Retencao e expurgo (LGPD)
1. Revise `docs/LGPD-POLITICA-RETENCAO-v1.md` e `docs/LGPD-ANEXO-OPERACIONAL-EXPURGO-v1.md`.
2. Configure no `.env`:
   - `RUN_DATA_RETENTION_JOBS`
   - `DATA_RETENTION_JOB_INTERVAL_MINUTES`
   - `DATA_RETENTION_DRY_RUN`
   - `ALLOW_DATA_RETENTION_DRY_RUN_IN_PRODUCTION`
   - `DATA_RETENTION_LEGAL_HOLD_USER_IDS`
   - Em producao, se `RUN_DATA_RETENTION_JOBS=true` e `DATA_RETENTION_DRY_RUN=true`, a API falha no boot por seguranca
     (a menos que `ALLOW_DATA_RETENTION_DRY_RUN_IN_PRODUCTION=true` seja definido como excecao temporaria controlada).
3. Antes de ativar em modo aplicacao, rode `npm run data-retention:dry-run` e valide o resultado.
4. Para aplicar manualmente: `npm run data-retention:apply`.
5. As execucoes sao auditadas na tabela `DataRetentionExecutionLog`.
6. Opcional via API admin:
   - `POST /admin/data-retention/run` para disparar execucao
   - `GET /admin/data-retention/runs` para consultar historico
