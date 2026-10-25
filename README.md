🇺🇸 English | 🇧🇷 [Português](README.pt-BR.md)

# Muvify

Two-sided marketplace connecting **personal trainers** to **clients**, supporting **in-person** sessions (single sessions and recurring-billing packages) and **online coaching** (remote training plans). Payments are processed end-to-end via **Mercado Pago**, with automatic marketplace split between platform and professional.

Node.js/TypeScript backend + React Native/Expo mobile app, in the same repository.

## Product overview

- **Client**: searches for professionals by location/category/rating, books in-person sessions or hires online coaching, tracks training plans and physical progress, and takes part in a gamified social feed.
- **Professional**: manages their schedule, validates their CREF license (Brazilian personal trainer certification), creates offers (single sessions, recurring packages, coaching, combos), delivers training plans, and tracks earnings/payouts.
- **Admin**: an internal operational role (not a sign-up account type — it's granted via a server-side allowlist of authorized emails, re-checked on every login). Validates CREF registrations, handles support, monitors platform finances, and manually resolves disputes (contested no-shows, bank chargebacks, failed automatic refunds).

## Technical highlights

- **Real marketplace split payments via Mercado Pago** — 90% professional / 10% platform split on both single sessions and coaching; PIX and card support; pre-authorization with capture on dual confirmation; **recurring per-cycle billing** for in-person packages (built on a custom cron-driven billing engine instead of Mercado Pago's native "Subscriptions" product, with retry logic and automatic cancellation after consecutive failures).
- **Anti-fraud proof of attendance**: single-use attendance code + confirmation selfie, with no-show detection and a dispute window before any automatic refund resolution.
- **Unified dispute queue for admins**: contested no-shows, chargebacks, and failed automatic refunds land in a single queue with full context already attached (evidence, chat history, timeline) — every resolution requires a justification that's sent to all parties involved.
- **Gamification & community**: XP, workout streaks, achievements, a follower system, and a progress feed with automatic, opt-in posts (explicit photo opt-in).
- **LGPD (Brazilian GDPR) by design**: automatic data purging via retention policy, data export/deletion on request, sensitive fields (banking data, documents) encrypted at rest, versioned Terms of Use and Privacy Policy (`docs/`).
- **Data security**: encrypted backups with automatic restore verification and offsite copies, WAL archiving for point-in-time recovery, PostgreSQL Row Level Security, a dedicated shadow-database environment to prevent risky migrations from ever touching real data, rate limiting, optional 2FA, token blacklisting.
- **Observability**: Prometheus metrics, Grafana dashboards, alerting (Slack/email/webhook), Sentry error tracking on the mobile app.
- **CI/CD**: GitHub Actions deploy pipeline with Docker build and automatic rollback if the health check fails after deploy.

## Stack

**Backend** — Node.js · TypeScript · Express · Prisma · PostgreSQL · Redis · Docker · JWT · Zod · Vitest · Swagger

**Mobile** (`mobile-app/`) — React Native · Expo · TypeScript · TanStack Query · Jest + Testing Library

**Payments** — Mercado Pago (marketplace split, PIX, card, subscription/cycle billing)

**Infra/observability** — Docker Compose · Prometheus · Grafana · Alertmanager · Sentry · GitHub Actions

## Project structure

```text
.
|-- mobile-app/              # React Native/Expo app (client + professional + admin)
|-- src/
|   |-- app.ts / server.ts / routes.ts
|   |-- config/              # env, prisma, redis
|   |-- middlewares/         # auth, rate-limit, role, validate, error
|   |-- modules/
|   |   |-- auth/
|   |   |-- admin/            # CREF validation, support, finance, disputes
|   |   |-- bookings/         # in-person scheduling, chat, no-shows
|   |   |-- consultancy/      # online coaching, training plans
|   |   |-- presential-packages/  # recurring-billing packages
|   |   |-- payments/         # Mercado Pago integration, webhooks, jobs
|   |   |-- community/        # social feed, follow system
|   |   |-- gamification/     # XP, streaks, achievements
|   |   |-- providers/        # professional profile, student management
|   |   |-- privacy/          # data retention/purging (LGPD)
|   |   `-- ...
|   `-- shared/               # errors, encryption, storage, utils
|-- prisma/                   # schema.prisma + migrations
|-- tests/                    # Vitest suite (integration via supertest)
|-- docs/                     # runbooks, release/QA checklists, Terms/Policy
|-- monitoring/               # Prometheus, Grafana, Alertmanager
`-- docker-compose*.yml
```

## Additional documentation

- `docs/OPERATIONS.md` — operations guide.
- `docs/INCIDENT-RUNBOOK.md` — incident response runbook (includes a real documented incident and the structural fix applied).
- `docs/RELEASE-READINESS-CHECKLIST.md` / `docs/QA-E2E-CHECKLIST.md` — release and QA checklists.
- `docs/FRONTEND-MOBILE-HANDOFF.md` — technical contract between the API and the mobile app.
- `docs/LGPD-POLITICA-RETENCAO-v1.md` / `docs/LGPD-ANEXO-OPERACIONAL-EXPURGO-v1.md` — data retention policy and execution (in Portuguese, as required by Brazilian law).
- `docs/TERMOS-DE-USO-v1.md` / `docs/POLITICA-DE-PRIVACIDADE-v1.md` — versioned legal documents (in Portuguese).
- `mobile-app/README.md` — how to run and test the mobile app.

## Getting started (backend)

1. Copy `.env.example` to `.env` and fill in the required values (Mercado Pago's test mode works for local development).
2. Start the infrastructure services:
   ```bash
   docker compose up -d
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Generate the Prisma client:
   ```bash
   npm run prisma:generate
   ```
5. Apply migrations:
   ```bash
   npm run prisma:deploy
   ```
6. Run the seed (pre-registered categories and exercises):
   ```bash
   npm run seed:all
   ```
7. Start the API:
   ```bash
   npm run dev
   ```

For the mobile app, see `mobile-app/README.md`.

## Tests

```bash
npm run test
```

Applies migrations to the test database (`TEST_DATABASE_URL`) and runs the full Vitest suite end-to-end (real integration testing via `supertest`, no database mocks).

Other useful commands:

```bash
npm run lint                    # full typecheck
npm run release:preflight       # validates config before a release
npm run release:gate            # lint + tests + strict preflight
npm run docs:openapi            # exports the OpenAPI contract to docs/openapi.json
```

## Monitoring

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`
- Alertmanager: `http://localhost:9093`

## Deploy

GitHub Actions pipeline (`.github/workflows/deploy.yml`): builds the Docker image, pushes it to the registry, and deploys remotely via SSH, with automatic rollback if the health check (`/health`) fails after the new version comes up. Prisma migrations are applied automatically on container startup.

## Backup and recovery

- `npm run db:backup` — encrypted (AES-256) PostgreSQL backup, with automatic upload to external storage when configured.
- `npm run db:backup:verify` — restores the latest backup to an isolated database to periodically validate integrity.
- `npm run db:basebackup` — physical base backup for point-in-time recovery (PITR), combined with WAL archiving.

## License

All rights reserved. The code is published for portfolio/technical-evaluation purposes — use, copying, or redistribution is not authorized without express permission.
