# Release Readiness Checklist

## Objetivo
Checklist tecnico para reduzir risco antes de promover versao para `staging` ou `production`.

## Comandos oficiais
1. Gate backend rapido:
```bash
npm run release:gate
```
2. Gate completo (backend + mobile):
```bash
npm run release:gate:full
```
3. Preflight isolado (config + conectividade — valida `JWT_SECRET`/`APP_ENCRYPTION_KEY`/`METRICS_TOKEN`/
   `EXPO_PUBLIC_SENTRY_DSN` de verdade desde a Frente 17, segunda camada):
```bash
npm run release:preflight
```
4. Preflight estrito (warnings bloqueiam):
```bash
npm run release:preflight:strict
```

## Checklist obrigatorio (backend)
1. `npm run prisma:generate` executa sem erro.
2. `npm run lint` verde.
3. `npm run test` verde.
4. `npm run release:preflight:strict` verde no ambiente alvo.
5. `npm run docs:openapi` atualizado quando houve mudanca de contrato.
6. Migration revisada e aplicada em homologacao antes de producao.
7. Smoke test pos-deploy executado com sucesso.

## Checklist obrigatorio (infra e operacao)
1. `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `APP_ENCRYPTION_KEY` definidos no ambiente alvo.
2. `AUTH_REQUIRE_REDIS_FOR_BLACKLIST=true` em producao.
3. SMTP valido em producao com:
   - `SMTP_VERIFY_ON_STARTUP=true`
   - `SMTP_TLS_REJECT_UNAUTHORIZED=true`
   - `RUN_EMAIL_RETRY_JOB=true`
4. `METRICS_TOKEN` configurado em producao.
5. Rotina de backup e verificacao de restore ativa.
6. Alertas (Slack/webhook/email) configurados e testados.
7. Endpoint `/health` retornando `readiness=ready` no ambiente alvo.
8. Gaps aceitos conscientemente (decisao do usuario, ver `docs/CARGA-REAL-GUIA-E-GAPS.md`), nao
   bloqueantes mas relevantes pro ato de fazer release: instancia unica (API+Postgres+Redis numa VM
   so, sem replicas) — todo deploy tem uma janela real de indisponibilidade (segundos, nao zero-downtime);
   testes de carga (`k6/stress.js`/`soak.js`) nao tem staging dedicado, nao rodam contra producao.

## Checklist obrigatorio (mobile)
1. `npm --prefix mobile-app run validate:release` verde.
2. Build EAS de homologacao concluido.
3. E2E Maestro (Frente 16, segunda camada) contra a build de homologacao — sem CI ainda (nao ha
   infra de device/emulador na pipeline), roda sob demanda antes do release:
   - `npm run e2e:seed` (semeia usuarios/agendamento de QA no banco alvo)
   - `npm run e2e:mobile:all` (ou `e2e:mobile:auth`/`e2e:mobile:client`/`e2e:mobile:professional`/`e2e:mobile:admin` por modulo)
   - cobre hoje: login/cadastro (feliz e negativo), navegacao principal (cliente e profissional),
     agendamento + pagamento Pix ate a geracao da cobranca, validacao presencial (codigo/QR) entre
     cliente e profissional, exclusao de conta (LGPD)
   - ver `mobile-app/e2e/SCENARIO_CATALOG.md` pro mapeamento completo (automatizado vs pendente)
4. Rodada manual final em dispositivo fisico Android e iOS — roteiro completo tela-por-tela em
   `docs/MANUAL-MOBILE-TEST-CHECKLIST.md` (checklist real de execucao, nao so a lista abaixo).
   Alternativa viavel pra operacao pequena (1 pessoa, sem device farm): Expo Go num unico celular
   fisico via Wi-Fi (LAN), como o proprio documento usa — nao precisa de simulador nem servico pago.
   Mínimo:
   - login/cadastro
   - 2FA
   - recuperacao de senha
   - agendamento
   - pagamento
   - notificacoes push
5. Politica de privacidade e declaracoes de loja revisadas — checklist detalhado na secao
   "Pre-submissao as lojas" abaixo.
6. Acessibilidade — rodada manual com leitor de tela ligado (TalkBack no Android, VoiceOver no iOS),
   pelo menos no fluxo de login/cadastro e num formulario critico (ex: anamnese ou criacao de ficha):
   - todo botao so-icone anuncia sua funcao (nao so "botao");
   - todo campo de formulario anuncia o rotulo correto ao ganhar foco;
   - erro de validacao e anunciado, nao so mostrado visualmente;
   - texto aumenta de tamanho quando a fonte do sistema e aumentada, sem cortar conteudo.
   (Nao existe ferramenta de lint de acessibilidade madura para React Native hoje — esta rodada manual
   e o unico gate real.)

## Pré-submissão às lojas (Frente 17, segunda camada — 2026-08-14)

App ainda em desenvolvimento nesta data: sem domínio público registrado, sem conta em nenhuma loja.
Itens abaixo já têm o conteúdo pronto onde possível; o resto só pode ser feito quando essas duas coisas
existirem. Não é parte do Go/No-Go técnico acima — é o checklist específico de "primeira submissão".

**Pronto, esperando domínio/conta:**
1. Política de privacidade e exclusão de conta já servidas como página pública pelo próprio backend
   (`/privacidade`, `/excluir-conta` — ver `src/modules/public/public.routes.ts`). Só falta um domínio
   apontar pro backend em produção.
2. Rascunho do formulário "Data Safety" (Google Play): `docs/GOOGLE-PLAY-DATA-SAFETY-DRAFT.md`.
3. Rascunho do "App Privacy" / nutrition label (Apple): `docs/APPLE-APP-PRIVACY-DRAFT.md`.
4. Justificativa + roteiro de vídeo pro formulário de localização em segundo plano (Google Play):
   `docs/GOOGLE-PLAY-BACKGROUND-LOCATION-JUSTIFICATION.md`.
5. Textos e checklist de assets de loja (ícone, screenshots, feature graphic, descrição):
   `mobile-app/STORE_ASSETS_GUIDE.md`.

**Bloqueado até existir domínio público:**
1. `associatedDomains` (iOS) / `intentFilters` com `autoVerify` (Android) pro deep link
   `https://muvify.app/...` funcionar como universal link/app link — hoje só o esquema customizado
   `muvify://` funciona (o que já é suficiente pro fluxo de validação de presença por QR, que nunca
   passa pelo linking do SO — ver `ProfessionalConfirmCompletionScreen`). Precisa de `assetlinks.json`
   (Android) e `apple-app-site-association` (iOS) servidos no domínio.
2. Atualizar a política de privacidade e o rascunho de Data Safety/App Privacy com a URL real depois
   que o domínio existir.

**Bloqueado até existir conta em cada loja:**
1. Google Play: `google-service-account.json` (referenciado em `mobile-app/eas.json::submit.production`,
   não existe hoje) — gerar no Play Console e nunca commitar no repo.
2. Apple: bloco `submit.production.ios` não existe em `mobile-app/eas.json` — precisa de Apple ID, Team
   ID e App Store Connect App ID de uma conta Apple Developer Program ativa (paga, USD 99/ano).
3. Screenshots reais e Feature Graphic — dependem de rodar o app numa build de verdade
   (`mobile-app/STORE_ASSETS_GUIDE.md` já lista as dimensões exigidas por cada loja).

## Go / No-Go
1. Go: todos os itens obrigatorios ok.
2. No-Go: qualquer item obrigatorio falho ou sem evidencia.

## Evidencias recomendadas
1. Link da pipeline CI verde.
2. Log do `release:preflight` no ambiente alvo.
3. Resultado do smoke pos-deploy.
4. Print ou ata da rodada manual mobile final.
5. Link para o runbook aplicado em incidente (quando houver): `docs/INCIDENT-RUNBOOK.md`.
