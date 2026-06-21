# Incident Runbook

## Objetivo
Guia rapido para resposta a incidentes de producao relacionados a disponibilidade de login, banco e entrega de e-mail.

## Triagem inicial (5 minutos)
1. Confirmar impacto real no usuario (login, cadastro, reset de senha, agendamento).
2. Validar `GET /health`:
   - `readiness=ready`: app apto a receber trafego.
   - `readiness=not_ready`: remover instancia do balanceador ate estabilizar.
3. Executar preflight no ambiente alvo:
```bash
npm run release:preflight -- --target=production
```
4. Registrar horario de inicio, servicos afetados e acao aplicada.

## Incidente 1: Redis indisponivel
### Sintomas
- Logs com falha de conexao Redis.
- `checks.redis=error` em `/health`.
- Se `AUTH_REQUIRE_REDIS_FOR_BLACKLIST=true`, instancia nao sobe ou retorna `503` em rotas autenticadas.

### Impacto
- Modo estrito (`AUTH_REQUIRE_REDIS_FOR_BLACKLIST=true`): protecao total, porem indisponibilidade ate Redis voltar.
- Modo fallback (`AUTH_REQUIRE_REDIS_FOR_BLACKLIST=false`): app segue ativo, mas blacklist local vale so na instancia atual.

### Acao imediata
1. Restaurar Redis (rede, credenciais, processo, memoria).
2. Manter `AUTH_REQUIRE_REDIS_FOR_BLACKLIST=true` em producao multi-instancia.
3. Se emergencia exigir fallback, documentar excecao e janela de risco.

### Validacao de saida
1. `/health` com `checks.redis=ok`.
2. Login, refresh e logout funcionando.
3. `npm run release:preflight -- --target=production` sem erro de Redis.

## Incidente 2: SMTP com certificado invalido/self-signed
### Sintomas
- Falha de `SMTP verify` no boot ou durante fila de e-mails.
- Erros TLS/certificado em logs do e-mail.

### Impacto
- Cadastro e reset continuam (best effort), mas usuario pode nao receber e-mails.
- Fila de retry pode acumular.

### Acao imediata
1. Corrigir cadeia de certificado do provedor SMTP (certificado valido e confiavel).
2. Em producao: manter `SMTP_TLS_REJECT_UNAUTHORIZED=true`.
3. Garantir `SMTP_VERIFY_ON_STARTUP=true` para falhar cedo quando SMTP estiver quebrado.
4. Garantir `RUN_EMAIL_RETRY_JOB=true` para drenagem automatica apos normalizacao.

### Validacao de saida
1. `SMTP connectivity` como `OK` no preflight.
2. Disparo de e-mail de teste concluindo sem erro.
3. Queda gradual da fila pendente de e-mails.

## Incidente 3: Database indisponivel
### Sintomas
- `/health` com `checks.database=error`.
- Falhas de login/cadastro/leituras com erro de conexao Prisma.

### Impacto
- Servico indisponivel (dependencia critica).

### Acao imediata
1. Validar disponibilidade do Postgres e conexoes (`DATABASE_URL`, pool, firewall, disco).
2. Verificar locks/migrations pendentes.
3. Se houve deploy recente, confirmar compatibilidade entre app e schema.

### Validacao de saida
1. `/health` com `checks.database=ok`.
2. `SELECT 1` via preflight como `OK`.
3. Fluxos de login/cadastro executados com sucesso.

## Pos-incidente (obrigatorio)
1. Registrar causa raiz.
2. Definir acao preventiva (alerta, ajuste de infra, automacao).
3. Atualizar este runbook quando houver novo aprendizado.
