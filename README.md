# Muvify

Marketplace de dois lados conectando **personal trainers** a **alunos**, com atendimento **presencial** (sessões avulsas e pacotes com cobrança recorrente) e **consultoria online** (planos de treino à distância). Pagamentos processados de ponta a ponta pelo **Mercado Pago**, com split automático entre plataforma e profissional.

Backend em Node.js/TypeScript + app mobile em React Native/Expo, no mesmo repositório.

## Visão geral do produto

- **Aluno**: busca profissionais por localização/categoria/nota, agenda sessões presenciais ou contrata consultoria online, acompanha planos de treino, evolução física e participa de um feed social com gamificação.
- **Profissional**: gerencia agenda, valida CREF, cria ofertas (avulsas, pacotes recorrentes, consultoria, combos), entrega fichas de treino, acompanha financeiro e recebimentos.
- **Admin**: valida cadastros de CREF, atende suporte, acompanha o financeiro da plataforma e resolve manualmente disputas (falta contestada, contestação bancária, reembolso automático que falhou).

## Destaques técnicos

- **Pagamentos com split real via Mercado Pago** — marketplace split (90% profissional / 10% plataforma) tanto em sessão avulsa quanto em consultoria; PIX e cartão; pré-autorização com captura em dupla confirmação; **cobrança recorrente por ciclo** para pacotes presenciais (sem depender do produto "Assinaturas" da MP — motor próprio orientado a cron, com retry e cancelamento automático após falhas consecutivas).
- **Prova de presença anti-fraude**: código de presença de uso único + selfie de comprovação, com detecção de falta e janela de contestação antes de qualquer resolução automática de reembolso.
- **Fila de disputas para o admin**: casos de falta contestada, chargeback e reembolso automático que falhou caem numa fila única, com todo o contexto (evidências, chat, histórico) já anexado — resolução sempre exige uma justificativa que é enviada às partes envolvidas.
- **Gamificação e comunidade**: XP, sequência de treinos, conquistas, sistema de seguidores e feed de evolução com posts automáticos e opcionais (com opt-in explícito de foto).
- **LGPD by design**: expurgo automático de dados por política de retenção, exportação/eliminação de dados a pedido do titular, campos sensíveis (dados bancários, documentos) criptografados em repouso, Termos de Uso e Política de Privacidade versionados (`docs/`).
- **Segurança de dados**: backups criptografados com verificação automática de restore e cópia offsite, WAL archiving para recuperação a um ponto no tempo, Row Level Security no Postgres, ambiente de *shadow database* dedicado para nunca aplicar uma migration arriscada contra dados reais, rate limiting, 2FA opcional, blacklist de tokens.
- **Observabilidade**: métricas Prometheus, dashboards Grafana, alertas (Slack/e-mail/webhook), rastreamento de erros com Sentry no app mobile.
- **CI/CD**: pipeline de deploy via GitHub Actions com build Docker, rollback automático se o healthcheck falhar após o deploy.

## Stack

**Backend** — Node.js · TypeScript · Express · Prisma · PostgreSQL · Redis · Docker · JWT · Zod · Vitest · Swagger

**Mobile** (`mobile-app/`) — React Native · Expo · TypeScript · TanStack Query · Jest + Testing Library

**Pagamentos** — Mercado Pago (split de marketplace, PIX, cartão, assinatura/ciclo)

**Infra/observabilidade** — Docker Compose · Prometheus · Grafana · Alertmanager · Sentry · GitHub Actions

## Estrutura do projeto

```text
.
|-- mobile-app/              # App React Native/Expo (cliente + profissional + admin)
|-- src/
|   |-- app.ts / server.ts / routes.ts
|   |-- config/              # env, prisma, redis
|   |-- middlewares/         # auth, rate-limit, role, validate, error
|   |-- modules/
|   |   |-- auth/
|   |   |-- admin/            # validação de CREF, suporte, financeiro, disputas
|   |   |-- bookings/         # agendamento presencial, chat, no-show
|   |   |-- consultancy/      # consultoria online, planos de treino
|   |   |-- presential-packages/  # pacotes com cobrança recorrente
|   |   |-- payments/         # integração Mercado Pago, webhooks, jobs
|   |   |-- community/        # feed social, follow
|   |   |-- gamification/     # XP, streak, conquistas
|   |   |-- providers/        # perfil profissional, gestão de alunos
|   |   |-- privacy/          # retenção/expurgo de dados (LGPD)
|   |   `-- ...
|   `-- shared/               # erros, criptografia, storage, utils
|-- prisma/                   # schema.prisma + migrations
|-- tests/                    # suíte Vitest (integração via supertest)
|-- docs/                     # runbooks, checklists de release/QA, Termos/Política
|-- monitoring/               # Prometheus, Grafana, Alertmanager
`-- docker-compose*.yml
```

## Documentação adicional

- `docs/OPERATIONS.md` — guia operacional.
- `docs/INCIDENT-RUNBOOK.md` — runbook de resposta a incidentes (com um incidente real documentado e a correção estrutural aplicada).
- `docs/RELEASE-READINESS-CHECKLIST.md` / `docs/QA-E2E-CHECKLIST.md` — checklists de release e QA.
- `docs/FRONTEND-MOBILE-HANDOFF.md` — contrato técnico entre API e app mobile.
- `docs/LGPD-POLITICA-RETENCAO-v1.md` / `docs/LGPD-ANEXO-OPERACIONAL-EXPURGO-v1.md` — política e execução de retenção de dados.
- `docs/TERMOS-DE-USO-v1.md` / `docs/POLITICA-DE-PRIVACIDADE-v1.md` — documentos legais versionados.
- `mobile-app/README.md` — como rodar e testar o app mobile.

## Como executar (backend)

1. Copie `.env.example` para `.env` e preencha os valores necessários (Mercado Pago em modo teste funciona para desenvolvimento local).
2. Suba os serviços de infraestrutura:
   ```bash
   docker compose up -d
   ```
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Gere o client do Prisma:
   ```bash
   npm run prisma:generate
   ```
5. Aplique as migrations:
   ```bash
   npm run prisma:deploy
   ```
6. Rode o seed (categorias e exercícios pré-cadastrados):
   ```bash
   npm run seed:all
   ```
7. Inicie a API:
   ```bash
   npm run dev
   ```

Para o app mobile, veja `mobile-app/README.md`.

## Testes

```bash
npm run test
```

Sobe as migrations no banco de teste (`TEST_DATABASE_URL`) e roda a suíte Vitest de ponta a ponta (integração real via `supertest`, sem mocks de banco).

Outros comandos úteis:

```bash
npm run lint                    # typecheck completo
npm run release:preflight       # valida config antes de um release
npm run release:gate            # lint + testes + preflight estrito
npm run docs:openapi            # exporta o contrato OpenAPI em docs/openapi.json
```

## Monitoramento

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`
- Alertmanager: `http://localhost:9093`

## Deploy

Pipeline via GitHub Actions (`.github/workflows/deploy.yml`): build da imagem Docker, push para o registry e deploy remoto via SSH, com rollback automático caso o healthcheck (`/health`) falhe após subir a nova versão. Migrations do Prisma são aplicadas automaticamente na inicialização do container.

## Backup e recuperação

- `npm run db:backup` — backup criptografado (AES-256) do Postgres, com upload automático para armazenamento externo quando configurado.
- `npm run db:backup:verify` — restaura o último backup num banco isolado para validar integridade periodicamente.
- `npm run db:basebackup` — base backup físico para recuperação a um ponto no tempo (PITR), combinado com WAL archiving.

## Licença

Todos os direitos reservados. O código está publicado para fins de portfólio/avaliação técnica — uso, cópia ou redistribuição não são autorizados sem permissão expressa.
