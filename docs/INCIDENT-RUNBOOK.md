# Incident Runbook

## Objetivo
Guia rapido para resposta a incidentes de producao relacionados a disponibilidade de login, banco e entrega de e-mail.

## Kill switches disponíveis
Env vars (`ENABLE_VIDEO_UPLOAD`, `ENABLE_REALTIME_CHAT`, ambas default `true` — ver `src/config/features.ts`)
que dá pra desligar sem deploy novo, só trocando a env e reiniciando o processo:
- `ENABLE_REALTIME_CHAT=false`: para de emitir mensagem em tempo real via WebSocket (útil se o socket.io estiver
  causando instabilidade) — app mobile cai pro polling REST automaticamente, sem quebrar.
- `ENABLE_VIDEO_UPLOAD=false`: para de aceitar/servir vídeo (perfil do personal e exercícios) — útil se upload de
  vídeo estiver sobrecarregando storage/banda.

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

## Incidente 4: Perda de dados no banco (reset acidental de schema)
### O que aconteceu (2026-07-20)
Um comando `prisma migrate diff` foi executado com `--shadow-database-url` apontando por engano para o mesmo banco de `DATABASE_URL` (banco real de desenvolvimento). O Prisma usa esse parametro como rascunho descartavel — ele deu `DROP SCHEMA public CASCADE` seguido de recriacao a partir das migrations em disco, apagando todos os dados (a estrutura das tabelas sobreviveu, os dados nao). O agendador de backup diario estava falhando silenciosamente havia semanas (dependia do Docker Desktop estar aberto no momento exato da rodada), entao o backup utilizavel mais recente tinha mais de um mes.

### Sintomas
- `SELECT count(*)` em qualquer tabela retorna 0 inesperadamente.
- `_prisma_migrations` ausente ou com historico incompleto.

### Acao imediata (restauracao rapida - perde no maximo 2h de dados)
1. Confirmar zero conexoes ativas: `docker exec marketplace_postgres psql -U postgres -d postgres -c "SELECT count(*) FROM pg_stat_activity WHERE datname='personal_app';"`
2. Restaurar o backup logico mais recente: `npm run db:restore` (usa o `.sql.enc` mais novo de `backups/`; para escolher outro, `npx tsx scripts/db-restore.ts --file <nome>`).
3. Se o backup restaurado for de uma migration antiga, trazer o schema atual por cima sem perder os dados: `npx prisma migrate deploy` (nunca `migrate dev`/`migrate reset` aqui — esses recriam do zero).
4. `npx prisma generate` e validar com `npm test`.

### Acao imediata (restauracao precisa - PITR, perde no maximo ~60s de dados)
Disponivel desde 2026-07-20: WAL continuo (`backups/wal/`, arquivado a cada 60s via `archive_command` no `docker-compose.yml`) + base backup fisico semanal (`backups/base/`, `npm run db:basebackup`, Tarefa Agendada `MuvifyDbBaseBackup`).
1. Parar o container: `docker compose stop postgres`.
2. Descriptografar e extrair o base backup mais recente (anterior ao base backup, mesmo header/AES-256-GCM dos backups logicos) para um diretorio de dados novo.
3. Criar `recovery.signal` no diretorio de dados e configurar `restore_command` apontando para `backups/wal/` e `recovery_target_time` para o instante desejado (logo antes do incidente).
4. Subir o Postgres apontando pro diretorio restaurado — ele reproduz o WAL ate o instante escolhido e para exatamente ali.
5. Validar dados, so entao promover (`pg_ctl promote` / remover `recovery.signal`) e trocar o volume em uso.

Esse procedimento e manual de proposito (a escolha do instante exato depende de julgamento humano sobre "ate onde restaurar"), mas os artefatos (WAL + base backup) ja existem e sao testados regularmente pela Tarefa Agendada.

### Prevencao estrutural (ja aplicada)
1. `schema.prisma` ganhou `shadowDatabaseUrl` dedicado (`SHADOW_DATABASE_URL`, banco `personal_app_shadow`) — `migrate dev`/`migrate diff` nunca mais precisam de `--shadow-database-url` manual, entao esse erro especifico nao se repete.
2. Backup deixou de depender de um processo `node` deixado aberto para sempre: Tarefa Agendada do Windows `MuvifyDbBackup` roda `npm run db:backup` a cada 2h independente de terminal aberto ou logon.
3. `npm run db:backup:healthcheck` roda apos cada backup e falha ruidosamente (log + toast do Windows + exit code != 0, visivel no historico da Tarefa Agendada) se o backup mais recente tiver mais de 26h.
4. WAL continuo + base backup semanal (`MuvifyDbBaseBackup`) habilitam a restauracao precisa acima.

### Validacao de saida
1. Contagem de linhas nas tabelas principais bate com o esperado.
2. `npx prisma migrate status` mostra "Database schema is up to date!".
3. `npm test` passa sem regressao.

## Reversao de release/migration sem perda de dados

Cobre o caso que os incidentes acima nao cobrem: nao e um desastre (banco corrompido, dado sumido), e um deploy
que "funciona" mas tem um bug — descoberto horas ou dias depois do deploy, nao no healthcheck automatico.

### Bug so no código do backend (schema nao mudou)
1. Identifique o commit anterior conhecido como bom (`git log`, ou a tag/SHA do deploy anterior).
2. Rode o workflow de deploy manualmente (`workflow_dispatch` em `.github/workflows/deploy.yml`) apontando pra
   esse commit, ou reconstrua/republique a imagem Docker daquele SHA (`ghcr.io/<repo>:<sha-anterior>`) e suba com
   `docker compose -f docker-compose.prod.yml up -d app` usando essa tag.
3. Nao precisa mexer em migration nenhuma se o schema nao mudou entre os dois commits.

### Bug so no código do mobile (JS/TS, sem mudanca de código nativo)
O app já tem EAS Update configurado (`expo-updates`, `app.json::updates`/`runtimeVersion`, canais `preview`/
`production` em `eas.json`) — publique um update pro canal certo em vez de esperar nova revisao de loja:
```bash
npm --prefix mobile-app run eas:update:production -- "descricao curta do hotfix"
```
So funciona pra mudanca de JS puro (sem novo pacote nativo, permissao nova, ou mudanca em `app.json`/`app.config`)
— essas exigem build+submissao nova como sempre. Antes de publicar pra `production`, valide o mesmo update no
canal `preview` primeiro (`eas:update:preview`).

### Migration de banco ruim (schema errado, mas dado gravado depois dela precisa ser preservado)
Prisma nao gera migration de "descer" automaticamente — reverter significa escrever uma NOVA migration que desfaz
a mudanca, nunca `prisma migrate reset`/`migrate dev` direto em producao (apaga dado — ver Incidente 4).

1. Identifique exatamente o que a migration ruim mudou (`prisma/migrations/<timestamp>_<nome>/migration.sql`).
2. Localmente, contra um banco de desenvolvimento/shadow (nunca o de producao), rode
   `npx prisma migrate dev --create-only --name revert_<nome>` depois de ajustar `schema.prisma` de volta pro
   estado anterior — isso gera o `migration.sql` de reversao pra voce revisar, nao pra aplicar cegamente.
3. Revise o SQL gerado a mao antes de qualquer coisa — automatico costuma gerar `DROP COLUMN`/`DROP TABLE` sem
   guarda; se a coluna/tabela recebeu dado real depois da migration ruim, ajuste o SQL pra preservar esse dado
   (ex.: migrar o valor pra outro lugar antes de derrubar a coluna) em vez de aceitar o diff literal.
4. Teste a migration de reversao contra uma copia recente do backup de producao (`npm run db:restore` num banco
   separado) antes de aplicar de verdade.
5. Aplique em producao do jeito normal: `npx prisma migrate deploy` (nunca `migrate dev`/`migrate reset`).

## Pos-incidente (obrigatorio)
1. Registrar causa raiz.
2. Definir acao preventiva (alerta, ajuste de infra, automacao).
3. Atualizar este runbook quando houver novo aprendizado.
