# Personal Services Marketplace API
Backend completo para um marketplace de servicos pessoais com Node.js, TypeScript, Express, Prisma, 
PostgreSQL, Redis, Docker, JWT e Swagger.
## Stack
- Node.js
- TypeScript
- Express
- Prisma
- PostgreSQL
- Redis
- Docker Compose
- JWT
- Swagger
- Zod
## Estrutura do projeto
```text
.
|-- docker-compose.yml
|-- docker-compose.prod.yml
|-- docker-compose.monitoring.yml
|-- Dockerfile
|-- package.json
|-- monitoring
|   |-- prometheus.yml
|   |-- alerts.yml
|   |-- alertmanager-entrypoint.sh
|   `-- grafana
|       |-- dashboards
|       `-- provisioning
|-- docs
|   `-- OPERATIONS.md
|-- prisma
|   |-- schema.prisma
|   `-- seed.ts
|-- src
|   |-- app.ts
|   |-- server.ts
|   |-- routes.ts
|   |-- config
|   |   |-- env.ts
|   |   |-- prisma.ts
|   |   `-- redis.ts
|   |-- docs
|   |   `-- swagger.ts
|   |-- observability
|   |   `-- metrics.ts
|   |-- middlewares
|   |   |-- auth.middleware.ts
|   |   |-- error.middleware.ts
|   |   |-- rate-limit.middleware.ts
|   |   |-- role.middleware.ts
|   |   `-- validate.middleware.ts
|   |-- modules
|   |   |-- auth
|   |   |-- availability
|   |   |-- bookings
|   |   |-- categories
|   |   |-- favorites
|   |   |-- notifications
|   |   |-- payments
|   |   |-- providers
|   |   |-- reviews
|   |   `-- users
|   `-- shared
|       |-- errors
|       |-- types
|       `-- utils
`-- tsconfig.json
```
## Entidades




- `User`
- `ProviderProfile`
- `ServiceCategory`
- `Availability`
- `Booking`
- `Review`
- `Favorite`
- `Session`
- `PasswordResetToken`
- `Payment`
- `PushDevice`
## Recursos implementados
- Autenticacao JWT
- Cadastro e login de usuarios
- Perfil profissional com categorias
- Busca de profissionais por nome, categoria e nota minima
- Favoritos
- Avaliacoes
- Agendamentos
- Disponibilidade de agenda
- Rate limit global e no login
- Cache Redis para categorias e busca de profissionais
- Swagger em `/api/docs`
- Metricas Prometheus em `/metrics`
- Validacao com Zod
- Tratamento global de erros
- Seguranca basica com `helmet`, `cors` e hash de senha com `bcrypt`
- Push notifications reais (Expo) com registro de device token e invalidacao automatica de tokens expirados
## Scripts npm
- `npm run dev`: inicia em desenvolvimento com watch
- `npm run build`: compila TypeScript
- `npm run start`: executa a versao compilada
- `npm run prisma:generate`: gera client Prisma
- `npm run prisma:migrate`: cria/aplica migrations em dev
- `npm run prisma:deploy`: aplica migrations em ambiente alvo
- `npm run prisma:studio`: abre Prisma Studio
- `npm run lint`: verifica tipos TypeScript
- `npm run seed`: popula categorias iniciais
- `npm run db:backup`: gera backup criptografado do Postgres
- `npm run db:backup:upload`: envia o ultimo backup para o S3
- `npm run db:backup:verify`: restaura o ultimo backup no banco de verificacao
- `npm run db:restore`: restaura o backup criptografado
- `npm run db:reset`: backup -> reset -> restore
- `npm run test`: executa testes com Vitest
- `npm run push:test`: envia push de teste para usuarios com device ativo (`PUSH_TEST_USER_IDS` opcional).
- `npm run docs:openapi`: exporta o contrato OpenAPI em `docs/openapi.json`
## Endpoints de push
- `POST /api/notifications/devices`: registra/atualiza token de push do usuario autenticado.
- `GET /api/notifications/devices`: lista dispositivos do usuario autenticado.
- `DELETE /api/notifications/devices`: desativa token de push do usuario autenticado.
- `POST /api/notifications/test`: envia notificacao de teste para o proprio usuario autenticado.
## Variaveis de ambiente
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: usados pelo Docker Compose.
- `APP_BASE_URL`: URL publica do backend (usada para callbacks Stripe quando o frontend nao existe).
- `DATABASE_URL`: conexao do Prisma.
- `TEST_DATABASE_URL`: conexao do banco de testes.
- `REDIS_URL`: conexao do Redis.
- `JWT_SECRET`, `JWT_EXPIRES_IN`: seguranca e expiracao do JWT.
- `ACCESS_TOKEN_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN_DAYS`: expiracao dos tokens.
- `PASSWORD_RESET_TOKEN_EXPIRES_MINUTES`: validade do token de recuperacao de senha.
- `BCRYPT_ROUNDS`: custo do hash da senha.
- `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`: limite de tentativas de login.
- `CORS_ORIGIN`: origem permitida para CORS.
- `METRICS_TOKEN`: token opcional para proteger `/metrics`.
- `BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`: backup criptografado.
- `BACKUP_OFFSITE_PROVIDER`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, `AWS_REGION`: backup offsite S3.
- `BACKUP_VERIFY_DATABASE_URL`: banco usado para validar restore periodicamente.
- `DB_BACKUP_MODE`, `DB_BACKUP_CONTAINER`, `PG_DUMP_BIN`, `PSQL_BIN`: execucao do backup.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: integracao Stripe Connect.
- `STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL`: callbacks explicitos do onboarding Connect (opcional).
- `PRE_AUTH_WINDOW_MINUTES`: janela para pre-autorizacao antes do agendamento.
- `AUTO_CAPTURE_CONFIRMATION_HOURS`: horas para captura automatica com confirmacao unica.
- `PAYMENT_JOB_INTERVAL_SECONDS`: intervalo do worker de pagamentos.
- `PUSH_NOTIFICATIONS_ENABLED`: habilita/desabilita envio de push.
- `EXPO_PUSH_API_URL`: endpoint do Expo Push API.
- `EXPO_PUSH_ACCESS_TOKEN`: token opcional para autenticar chamadas no Expo Push API.
- `STRIPE_E2E_PROVIDER_ACCOUNT_ID`: conta Connect ja habilitada para teste E2E real (opcional, recomendado).
- `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`: acesso inicial do Grafana.
- `ALERT_WEBHOOK_URL`: webhook para alertas (Slack/Teams/etc).
- `ALERT_SLACK_WEBHOOK`, `ALERT_SLACK_CHANNEL`, `ALERT_SLACK_USERNAME`: alertas via Slack nativo do Alertmanager.
- `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`, `ALERT_SMTP_HOST`, `ALERT_SMTP_PORT`, `ALERT_SMTP_USER`, `ALERT_SMTP_PASS`, `ALERT_SMTP_TLS`: alertas por email via SMTP.
Para gerar `BACKUP_ENCRYPTION_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
## Como executar
1. Copie `.env.example` para `.env`.
2. Suba os servicos:
```bash
docker compose up -d
```
3. Instale dependencias:
```bash
npm install
```
4. Gere o client Prisma:
```bash
npm run prisma:generate
```
5. Rode as migrations:
```bash
npm run prisma:migrate
```
6. Rode o seed:




```bash
npm run seed
```
7. Inicie a API:
```bash
npm run dev
```
## Testes
Os testes usam o Postgres local. Garanta que o banco esta ativo e com migrations aplicadas:
```bash
npm run prisma:migrate
npm run test
```
Se preferir rodar em container (recomendado para consistencia):
```bash
npm run test:docker
```
Teste E2E real com Stripe test mode:
```bash
npm run stripe:e2e
```
Sem frontend pronto, o backend usa callbacks locais por padrao:
- `GET /stripe/return`
- `GET /stripe/refresh`

Smoke test completo (subindo app em container):
```bash
npm run smoke:docker
```
Teste de carga (saude/metrics) em container:
```bash
npm run load:docker
```
Exportar contrato OpenAPI para frontend/mobile:
```bash
npm run docs:openapi
```
## Monitoramento
Suba o stack de observabilidade:
```bash
docker compose -f docker-compose.monitoring.yml up -d
```
Prometheus: `http://localhost:9090`  
Grafana: `http://localhost:3001` (usuario/senha conforme `.env`)  
Alertmanager: `http://localhost:9093`
Para monitorar o container da API, suba junto com o app:
```bash
docker compose -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d
```
## Alertas (Slack/Email/Webhook)
1. Para Slack, configure `ALERT_SLACK_WEBHOOK` e opcionalmente `ALERT_SLACK_CHANNEL`.
2. Para webhook generico, configure `ALERT_WEBHOOK_URL`.
3. Para email, configure as variaveis `ALERT_EMAIL_*` e `ALERT_SMTP_*`.
4. O Alertmanager habilita automaticamente os canais configurados via `.env`.
## Deploy
1. Configure secrets por ambiente em GitHub Environments: `REGISTRY_USER`, `REGISTRY_PASSWORD` (ou use `GITHUB_TOKEN` para GHCR), `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`.
2. Atualize o servidor com `docker compose` e `.env` de producao.
3. Push na branch `staging` publica e faz deploy no ambiente `staging`. Push em `main` faz deploy em `production`.
4. O deploy possui rollback automatico se o `/health` falhar.
5. Configure `SMOKE_BASE_URL` e, se necessario, `METRICS_TOKEN`, `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD` para o smoke test pos-deploy.
## Backup offsite e verificacao
1. Configure `BACKUP_OFFSITE_PROVIDER=s3`, `BACKUP_S3_BUCKET`, `AWS_REGION`.
2. Rode `npm run db:backup` para gerar e enviar o backup (upload automatico quando o provider estiver ativo).
3. Programe `npm run db:backup:verify` com `BACKUP_VERIFY_DATABASE_URL` apontando para um banco exclusivo.
4. Se definir `METRICS_TOKEN`, ajuste o Prometheus para enviar o bearer token na coleta.
## Handoff frontend/mobile
- Guia tecnico: `docs/FRONTEND-MOBILE-HANDOFF.md`
- Contrato API versionado: `npm run docs:openapi` (gera `docs/openapi.json`)
## Endpoints principais
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/payments/customer`
- `POST /api/payments/customer/setup-intent`
- `POST /api/payments/customer/setup-intent/confirm`
- `POST /api/payments/customer/setup` (legado)
- `POST /api/payments/provider/account`
- `POST /api/payments/provider/account/onboarding-link`
- `GET /api/payments/provider/account`
- `GET /api/payments/booking/:bookingId`
- `POST /api/payments/booking/:bookingId/pix/charge`
- `POST /api/payments/webhook`
- `GET /stripe/return`
- `GET /stripe/refresh`
- `GET /metrics`
- `GET /api/users/me`
- `GET /api/categories`
- `POST /api/categories`
- `GET /api/providers`
- `GET /api/providers/:providerId`
- `POST /api/providers/profile`
- `GET /api/availability/me`
- `POST /api/availability`
- `GET /api/bookings/me`
- `POST /api/bookings`
- `PATCH /api/bookings/:bookingId/status`
- `POST /api/reviews`
- `GET /api/favorites`
- `POST /api/favorites`
- `DELETE /api/favorites/:providerId`
## Regras de negocio principais
- Apenas usuarios autenticados acessam recursos privados.
- Apenas `ADMIN` cria categorias.
- Um usuario so pode ter um perfil profissional.
- Avaliacao so pode ser criada pelo cliente de um agendamento concluido.
- Agendamento valida disponibilidade e conflito de horario.
- Pagamento com cartao (credito/debito) usa pre-autorizacao Stripe 1h antes do horario (`PRE_AUTH_WINDOW_MINUTES`).
- Pagamento via PIX e iniciado pelo endpoint `POST /api/payments/booking/:bookingId/pix/charge`.
- Split fixo em todos os pagamentos: `90%` para profissional e `10%` de comissao para o app.
- Cliente precisa de metodo de pagamento digital configurado para liberar criacao de agendamento no app mobile.
- Captura acontece com dupla confirmacao de conclusao ou automaticamente apos 24h de confirmacao unica.
- Cancelamento do agendamento cancela pre-autorizacao ou estorna se ja capturado.
- Redefinicao de senha invalida todas as sessoes ativas do usuario.
- Favoritos nao duplicam por usuario/prestador.
- Em `development/test`, o endpoint de forgot-password pode retornar `resetToken` para testes locais.
## Swagger
Depois de subir a API:
- `http://localhost:3000/api/docs`
