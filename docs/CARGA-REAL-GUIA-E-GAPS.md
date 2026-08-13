# Carga real — guia de migrations seguras e gaps conhecidos

Este documento nasceu da Frente 14 (segunda camada, "carga real") do épico de
auditoria contínua do backend — investigação dedicada a como o sistema se
comporta sob tráfego de produção de verdade (muitos usuários simultâneos,
muito dado acumulado), não os volumes pequenos usados em teste.

## 1. Migrations seguras em produção

Hoje todas as migrations do histórico (`prisma/migrations/`) rodam dentro da
transação padrão do `prisma migrate deploy`. Isso é seguro enquanto as
tabelas são pequenas (poucos milhares de linhas), mas duas operações ficam
perigosas assim que uma tabela crescer de verdade:

### `CREATE INDEX` sem `CONCURRENTLY`

Um `CREATE INDEX` normal trava ESCRITA na tabela até terminar de construir o
índice inteiro. Numa tabela pequena isso é imperceptível (milissegundos);
numa tabela grande (`Booking`, `Payment`, `User`, `UserNotification` com
centenas de milhares de linhas) pode travar escrita por minutos — e como a
produção hoje é instância única (ver seção 2), isso significa a API
inteira travada nesse tempo, não só a tabela.

**Antes de criar um índice numa tabela que já tem volume real:**

1. Gere a migration sem aplicar: `npx prisma migrate dev --create-only --name nome_da_migration`.
2. Edite o SQL gerado manualmente: troque `CREATE INDEX "Nome" ON "Tabela"(...)` por
   `CREATE INDEX CONCURRENTLY "Nome" ON "Tabela"(...)`.
3. `CREATE INDEX CONCURRENTLY` não pode rodar dentro de uma transação — adicione
   `-- prisma-client-js` acima ou, mais simples, aplique esse SQL específico manualmente
   fora do fluxo padrão de `migrate deploy` (`psql` direto, fora de transação), documentando
   isso no PR.
4. Rode contra uma cópia/staging antes de aplicar em produção, se possível.

### `ALTER COLUMN ... SET DATA TYPE` / qualquer mudança que reescreva a tabela

Mudar o tipo de uma coluna (ex: a migration `20260805005023_frente11_lote3_encrypt_sensitive_fields`,
que trocou o tipo de `ClientAnamnesis.answers`) força o Postgres a reescrever a
tabela inteira sob lock exclusivo. Já rodou sem problema porque a tabela era
pequena na época — mas o mesmo tipo de mudança numa tabela grande no futuro
trava tudo pelo tempo da reescrita completa.

**Antes de uma mudança de tipo de coluna numa tabela grande:** prefira uma
migração em etapas (adicionar coluna nova, backfill em lote com `take`/
concorrência limitada — mesmo padrão já usado em vários jobs do código —,
trocar o código pra ler da coluna nova, só então remover a antiga) em vez de
um `ALTER ... SET DATA TYPE` direto.

### Checklist rápido antes de aplicar uma migration em produção

- [ ] A tabela afetada tem volume real (não só ambiente de teste)?
- [ ] A operação é `CREATE INDEX`? → usar `CONCURRENTLY` (fora de transação).
- [ ] A operação muda tipo/reescreve a tabela inteira? → considerar migração em etapas.
- [ ] Existe backup recente? (ver `docs/OPERATIONS.md`, seção "Backup automático")
- [ ] Testado num ambiente com volume comparável, se possível?

## 2. Gaps conhecidos, aceitos por ora (decisão de custo)

A investigação da Frente 14 encontrou dois problemas estruturais ligados à
mesma causa raiz: **o backend roda como instância única** (API, Postgres e
Redis na mesma VM, sem réplicas — ver `docker-compose.prod.yml`,
`.github/workflows/deploy.yml`). Resolver isso de vez exigiria escalar para
múltiplas réplicas, o que tem custo real de hosting proporcional ao número
de instâncias. Decisão explícita do usuário (13/08/2026): mitigar sem
aumentar custo por ora, documentar o resto como gap aceito.

### Deploy não é zero-downtime

`Dockerfile:CMD` roda `prisma migrate deploy && node dist/server.js` no boot
do container. Como só existe uma instância, não há como rotear tráfego para
uma instância "antiga" enquanto a nova sobe — `deploy.yml` já minimiza o
impacto (health check + rollback automático pro image anterior se falhar,
ver linhas 46-57), mas a janela entre "container antigo parado" e "container
novo respondendo ao /health" é uma janela real de indisponibilidade, hoje
medida em segundos por deploy (não minutos, contanto que as migrations
sigam o checklist da seção 1).

**Mitigação aplicada nesta frente (sem custo extra):** limites de CPU/memória
por container em `docker-compose.prod.yml` (Lote 7) — evita que um pico de
tráfego na API sufoque o Postgres/Redis que dividem o mesmo host, o que
tornaria qualquer degradação pior do que precisa ser.

**Se/quando a operação decidir escalar:** múltiplas réplicas do backend
resolvem isso de vez (rolling deploy real) — nesse momento, revisar também
`connection_limit` do Prisma (`src/config/prisma.ts`, hoje 20 por processo,
não dividido entre réplicas — ver comentário no arquivo).

### Testes de carga (k6) não rodam sozinhos

`k6/load.js`, `stress.js`, `soak.js` existem e são bem desenhados, mas não
há ambiente de staging dedicado nem gatilho automático — rodar `stress.js`/
`soak.js` sem supervisão contra produção é arriscado (o próprio script
`stress.js` avisa: "não rodar em produção com usuários reais") e rodar
contra um staging exigiria manter um segundo ambiente pago só pra isso.

**Resolvido nesta frente:** `k6/smoke.js` (30s, carga irrisória) passou a
ter um workflow manual dedicado (`.github/workflows/load-test.yml`,
`workflow_dispatch`) que aceita qualquer um dos 4 cenários (`smoke`, `load`,
`stress`, `soak`) contra a URL que o operador indicar — disparado
manualmente antes de releases grandes, nunca automático, exatamente pelo
motivo acima.
