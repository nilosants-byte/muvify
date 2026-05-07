# MuviFy Mobile

Frontend mobile-first em React Native + Expo + TypeScript, pronto para integrar com o backend deste repositorio.

## Implementado
- Tema visual consistente: preto, branco e verde (`rgb(25,180,80)`).
- Fluxo base completo:
  - Splash
  - Onboarding (carrossel 4 slides, autoplay de 5s, sem zoom)
  - Escolha de perfil (Cliente/Profissional)
  - Login, cadastro e tela de recuperacao de senha
  - Navegacao modular unica (Cliente e Profissional com tabs + stacks)
- Integracao real com API (sem mocks) para:
  - Auth (`/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`)
  - Recuperacao de senha (`/auth/forgot-password`, `/auth/reset-password`)
  - Usuario atual (`/users/me`)
  - Categorias e busca de profissionais
  - Favoritos
  - Agendamentos e mudanca de status
  - Avaliacoes
  - Disponibilidade do profissional
  - Metodo de pagamento do cliente com Stripe PaymentSheet (status + setup intent + confirmacao)
  - Stripe Connect status/onboarding
  - Status de pagamento por agendamento
  - Agenda profissional e confirmacao de conclusao
  - Perfil do cliente e perfil profissional (criacao)
  - Registro automatico de push token (Expo) apos login
  - Unregister de token no logout
- Estados de UX:
  - loading, vazio, erro, sucesso e offline
- Regra global de conectividade:
  - sem internet, o app mostra tela de aviso e bloqueia onboarding/login/uso
  - a tela offline tem botao "Tentar novamente" para rechecagem imediata
  - ao reconectar, o acesso volta automaticamente
  - durante queda rapida de conexao em uso, exibe banner discreto por alguns segundos
  - se a queda persistir, ativa bloqueio global novamente

## Validacao tecnica
- `npx tsc --noEmit` aprovado.
- `npx expo-doctor` aprovado (17/17 checks).

## Testes
- Stack: `jest-expo` + `@testing-library/react-native`.
- Fluxos cobertos:
  - bloqueio offline global + botao "Tentar novamente"
  - login
  - cadastro
  - setup de metodo de pagamento do cliente
  - busca de profissionais
  - criacao de agendamento
  - status de pagamento
- Comandos:
  - `npm run test`
  - `npm run test:coverage`
  - `npm run test:watch`
  - `npm run typecheck`
  - `npm run doctor`
  - `npm run validate:release`
- Threshold global de cobertura (enforced):
  - branches: `60%`
  - functions: `75%`
  - lines: `75%`
  - statements: `75%`

## Como rodar
```bash
cd mobile-app
npm install
npm run start
```

Opcional:
```bash
npm run android
npm run ios
npm run web
```

## Usar Expo Go (gratis, recomendado para testes locais)
Este projeto foi ajustado para Expo SDK `54.0.0`, compativel com Expo Go sem conta Apple Developer paga.

1. Instale no celular:
- iOS: `Expo Go` na App Store
- Android: `Expo Go` na Play Store

2. No computador:
```bash
cd mobile-app
npm install
npm run start:tunnel
```

3. No celular:
- abra o app `Expo Go`
- toque em "Scan QR Code"
- leia o QR mostrado no terminal

4. Se nao conectar:
- deixe celular e computador na mesma rede OU mantenha `--tunnel`
- desative VPN/proxy no computador
- reinicie com cache limpo: `npm run start:tunnel`

## Opcional: Development Build iOS
Se no futuro voce entrar no Apple Developer pago, tambem pode usar Development Build:

1. Login no Expo (uma vez):
```bash
npx eas login
```

2. Registrar seu iPhone no EAS (uma vez):
```bash
npm run eas:device:create
```

3. Gerar build de desenvolvimento iOS:
```bash
npm run eas:build:dev:ios
```

4. Instalar no iPhone:
- abra o link retornado pelo EAS Build
- instale via TestFlight ou link interno (conforme conta Apple)

5. Rodar bundler para Development Build:
```bash
npm run start:dev-client
```
Se LAN falhar, use:
```bash
npm run start:dev-client:tunnel
```

6. No iPhone, abra o app instalado (nao Expo Go) e conecte ao projeto.

## Configuracao de API
Defina o endpoint da API para dispositivo fisico/emulador:

```bash
EXPO_PUBLIC_API_BASE_URL=http://SEU_IP:3000/api
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
EXPO_PUBLIC_EAS_PROJECT_ID=
EXPO_PUBLIC_SENTRY_DSN=
EXPO_PUBLIC_APP_ENV=development
```

Sem essa variavel, o app usa fallback:
- Android emulator: `http://10.0.2.2:3000/api`
- Outras plataformas: `http://localhost:3000/api`

Modelo base de variaveis: `mobile-app/.env.example`.

## Push Notifications (Expo)
- Mobile:
  - token obtido via `expo-notifications` + `expo-device`
  - sincronizacao automatica com backend em `src/state/AppState.tsx`
  - utilitario em `src/services/notifications/push.ts`
- Backend (API):
  - `POST /api/notifications/devices`
  - `GET /api/notifications/devices`
  - `DELETE /api/notifications/devices`
  - `POST /api/notifications/test` (envio de teste para o usuario autenticado)
- Variaveis backend:
  - `PUSH_NOTIFICATIONS_ENABLED=true|false`
  - `EXPO_PUSH_API_URL=https://exp.host/--/api/v2/push/send`
  - `EXPO_PUSH_ACCESS_TOKEN=` (opcional)

## Observabilidade (Sentry)
- Dependencia integrada: `@sentry/react-native`.
- Inicializacao central em `src/observability/sentry.ts`.
- Bootstrap no `App.tsx`.
- Usuario autenticado sincronizado para contexto de erro via `src/state/AppState.tsx`.
- Tratamento de erro de tela envia excecao para Sentry em `src/screens/shared/api-helpers.ts`.
- Variaveis:
  - `EXPO_PUBLIC_SENTRY_DSN`
  - `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (0 a 1, default `0.1`)
  - `EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE` (0 a 1, default `0`)
  - `EXPO_PUBLIC_APP_ENV` (`development|preview|production`)

## Release Mobile (EAS)
- Config base criada em `mobile-app/eas.json`.
- Scripts adicionados:
  - `npm run eas:build:preview:android`
  - `npm run eas:build:preview:ios`
  - `npm run eas:build:production:all`
  - `npm run eas:submit:production:all`
- Workflow CI/CD mobile:
  - `.github/workflows/mobile-release.yml`
  - gatilho manual `workflow_dispatch` com parametros:
    - `platform`: `android|ios|all`
    - `profile`: `preview|production`
    - `auto_submit`: `true|false`
- Secrets necessarios no GitHub:
  - `EXPO_TOKEN`
  - `MOBILE_EAS_PROJECT_ID`
  - `MOBILE_EXPO_PUBLIC_API_BASE_URL`
  - `MOBILE_EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `MOBILE_EXPO_PUBLIC_SENTRY_DSN` (opcional, recomendado)
  - `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (se upload de sourcemaps estiver ativo)

## Onboarding com imagens oficiais
1. Coloque as 4 imagens em `assets/onboarding/`.
2. Atualize `src/data/onboardingSlides.ts` com os caminhos finais.

## Estrutura principal
- `src/navigation/root-stack.tsx`
- `src/navigation/client-tabs.tsx`
- `src/navigation/professional-tabs.tsx`
- `src/screens/auth/*`
- `src/screens/client/*`
- `src/screens/professional/*`
- `src/screens/shared/*`
- `src/components/ui/*`
- `src/services/api/client.ts`
- `src/state/AppState.tsx`
- `src/theme/tokens.ts`

## Pontos pendentes (manual)
- Substituir imagens do onboarding pelas imagens oficiais do produto.
- Ajustar variaveis de ambiente mobile (`API`, `Stripe`, `Sentry`) para preview/producao.
- Configurar credenciais de loja para `eas submit` (Google Play e App Store Connect).
- Configurar canal real de envio do token de recuperacao em producao (email/SMS).
