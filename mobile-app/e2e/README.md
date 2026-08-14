# E2E Mobile (Maestro)

## Ferramenta escolhida

`Maestro` foi escolhida como base E2E mobile para este projeto porque:

- funciona de forma nativa para Android e iOS;
- integra bem com React Native/Expo sem exigir setup pesado de instrumentation;
- custo zero para uso local;
- curva de aprendizado menor e manutenção mais simples para fluxos de produto;
- permite gerar evidencias de execucao (debug output + screenshots + JUnit em modo report).

## Por que nao Playwright como base principal aqui

Playwright e excelente para web. Neste projeto, o alvo principal e app mobile nativo (Android/iOS), entao:

- Playwright nao cobre de forma nativa os componentes/gestos do app mobile instalado;
- forcar E2E principal via web nao valida o comportamento real de runtime mobile;
- Maestro/Detox sao mais aderentes para fluxo de app instalado.

Playwright pode continuar como complemento para web/capturas, mas nao como pilar de regressao mobile.

## Estrutura

```txt
e2e/
  smoke/         # app abre e chega no login
  auth/          # login, cadastro, recuperar senha
  client/        # navegacao/telas do cliente
  professional/  # navegacao/telas do profissional
  admin/         # validacao de CREF, etc.
  fixtures/      # usuarios de teste (users.json)
  helpers/       # flows reutilizaveis (_login-*, _logout)
  reports/       # saida de execucao com --report (gitignored)
```

Frente 16 (segunda camada) consolidou duas arvores paralelas de E2E que existiam desde a
criacao do projeto (uma solta no topo com sistema de lotes por prioridade, outra dentro de
`maestro/`) numa unica arvore, porque as duas estavam quebradas contra o app atual e nenhuma
das duas rodava em nenhum processo real. Ver `project_segunda_camada_epic.md` (memoria) para o
raio-x completo.

## Pre-requisitos

- Maestro CLI instalado e no `PATH`.
- Emulador Android/iOS ou device fisico conectado.
- App instalado com `appId` `com.personalapp.mobile` (dev/preview build recomendado para estabilidade).
- Backend acessivel pela app, com os usuarios de QA seedados (ver "Dados de teste" abaixo).

## Dados de teste

Os flows autenticam com os usuarios definidos em `e2e/fixtures/users.json`. Cliente e
profissional sao criados/atualizados por um script dedicado (roda a partir da raiz do
backend, precisa de acesso ao Postgres):

```bash
npm run e2e:seed
```

O usuario admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`, usados por `helpers/_login-admin.yaml`) e o
mesmo criado pelo seed principal do backend (`npm run seed`, ver `prisma/seed.ts`) —
`muvifyadm@gmail.com`. A senha em texto plano nao fica no repo (o seed grava só o hash); passe
por variavel de ambiente na hora de rodar:

```bash
ADMIN_EMAIL=muvifyadm@gmail.com ADMIN_PASSWORD=<senha real> npm run e2e:admin --prefix mobile-app
```

## Execucao

- Todos os modulos:

```bash
npm run e2e:all
```

- Por modulo:

```bash
npm run e2e:smoke
npm run e2e:auth
npm run e2e:client
npm run e2e:professional
npm run e2e:admin
```

- Com relatorio/evidencias (JUnit em `e2e/reports/report.xml`):

```bash
npm run e2e:report
```

Os mesmos comandos existem prefixados com `e2e:mobile:` na raiz do backend (ex.:
`npm run e2e:mobile:all`), que so delegam para `mobile-app` via `npm --prefix`.

## Como adicionar novos testes

1. Crie um `.yaml` no modulo correto (ex.: `e2e/client/`).
2. Use seletores estaveis via `testID` sempre que possivel — convencao em `e2e/helpers/README.md`.
3. Inclua cenarios positivos e negativos.
4. Adicione `takeScreenshot` nos pontos-chave do fluxo.
5. Antes de commitar, confira que todo `id:` referenciado no flow existe de fato no codigo
   (`grep -rn "testID=\"<id>\"" ../src`) — testID drift foi a causa raiz de as duas arvores
   antigas terem apodrecido em silencio (a bottom nav do cliente e do profissional mudou de
   componente/rotulo sem os flows serem atualizados).

## Limitacoes atuais

- Ainda nao ha CI rodando esses flows automaticamente — nenhum workflow do repo (nao ha
  `.github/workflows`) invoca Maestro. `RELEASE-READINESS-CHECKLIST.md` documenta o comando
  como passo recomendado antes de release, mas a execucao continua manual/sob demanda.
- Sem cobertura de pagamento real (Mercado Pago), upload real de midia ou camera nativa real —
  essas partes seguem em validacao manual (ver `docs/QA-E2E-CHECKLIST.md`).
- `e2e/client/01-home-tabs.yaml` e fluxos de booking assumem fixture da API mock ou dados
  seedados pelo `e2e:seed`.

## Proximos passos recomendados

- CI dedicado (mesmo que so `smoke` por commit, dado o custo de infra de device/emulador).
- Cobertura de disputa e chat (adiado nesta frente por serem fluxos MEDIUM/administrativos
  frente ao ROI de instrumentar testID nas telas que ainda nao tem).
