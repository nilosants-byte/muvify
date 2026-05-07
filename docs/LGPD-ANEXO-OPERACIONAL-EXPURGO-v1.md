# Muvify - Anexo Operacional de Expurgo (v1)

- Versao: `1.0.0`
- Data: `2026-05-03`
- Escopo: backend (`src/modules/privacy`) e operacao de rotina

## 1. Objetivo operacional
Definir como o expurgo e executado na pratica, com seguranca, previsibilidade e trilha de auditoria.

## 2. Componentes tecnicos implementados

1. Servico de retencao:
   - `src/modules/privacy/services/data-retention.service.ts`
2. Job agendado com lock em banco:
   - `src/modules/privacy/jobs/data-retention.job.ts`
3. Persistencia de auditoria:
   - tabela `DataRetentionExecutionLog` (Prisma + migration)
4. Script manual para operacao controlada:
   - `scripts/data-retention-run.ts`

## 3. Variaveis de ambiente

| Variavel | Tipo | Padrao | Uso |
|---|---|---|---|
| `RUN_DATA_RETENTION_JOBS` | boolean | `true` | Liga/desliga o agendamento automatico |
| `DATA_RETENTION_JOB_INTERVAL_MINUTES` | int | `1440` | Intervalo do job (em minutos) |
| `DATA_RETENTION_DRY_RUN` | boolean | `true` | Simulacao sem alterar dados |
| `DATA_RETENTION_LEGAL_HOLD_USER_IDS` | csv | vazio | IDs de usuarios com bloqueio de expurgo |

## 4. Modos de execucao

### 4.1 Agendado (servidor)
Executa automaticamente via `server.ts`, respeitando lock para evitar concorrencia entre instancias.

### 4.2 Manual (operacional)

1. Simulacao (recomendado antes de aplicar):
```bash
npm run data-retention:dry-run
```

2. Aplicacao real:
```bash
npm run data-retention:apply
```

3. Com identificacao de origem:
```bash
tsx scripts/data-retention-run.ts --apply --triggered-by=RELEASE_2026_05_03
```

### 4.3 Manual via API admin

Endpoints protegidos para papel `ADMIN`:

1. Disparar execucao:
```http
POST /admin/data-retention/run
Content-Type: application/json

{
  "dryRun": true,
  "triggeredBy": "ADMIN_PANEL_RELEASE_2026_05_03"
}
```

2. Consultar historico:
```http
GET /admin/data-retention/runs?take=30
```

## 5. Fluxo minimo de mudanca segura

1. Rodar dry-run e revisar volume por regra.
2. Validar se existe legal hold pendente.
3. Garantir backup recente e testado.
4. Rodar apply em janela controlada.
5. Conferir log em `DataRetentionExecutionLog` com status `SUCCESS`.

## 6. Politica de falhas

1. Falha de banco ativa backoff exponencial no job.
2. Falha funcional registra execucao `FAILED` com erro.
3. Sem lock, a execucao e abortada para evitar corrida entre pods/processos.

## 7. Checklist de go-live

1. Migration aplicada em producao.
2. `DATA_RETENTION_DRY_RUN=false` apos validacao em homologacao.
3. `DATA_RETENTION_JOB_INTERVAL_MINUTES` definido conforme janela operacional.
4. Processo de legal hold definido entre Operacoes + Juridico.
5. Dono responsavel por revisao semestral nomeado.

## 8. Indicadores recomendados

1. Volume de registros candidatos por regra (dry-run).
2. Volume efetivamente expurgado/redigido por regra.
3. Taxa de falha do job e tempo medio de recuperacao.
4. Tempo de atendimento de solicitacoes de eliminacao de titulares.

## 9. Limites conhecidos desta versao (aceitavel v1)

1. Regras em codigo fixo (nao parametrizadas por painel administrativo).
2. Legal hold por lista de `userId` (CSV), sem workflow dedicado.
3. Endpoint admin permite disparo e consulta de execucao, mas ainda sem tela administrativa dedicada no app.

Esses pontos nao impedem producao com seguranca aceitavel, mas devem evoluir na proxima rodada de maturidade.
