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
  smoke/
  auth/
  onboarding/
  profile/
  scheduling/
  professional/
  payments/
  uploads/
  regression/
  batches/
  helpers/
  fixtures/
  reports/
```

## Pre-requisitos

- Maestro CLI instalado e no `PATH`.
- Emulador Android/iOS ou device fisico conectado.
- App instalado com `appId` `com.personalapp.mobile` (dev/preview build recomendado para estabilidade).
- Backend acessivel pela app.

## Execucao rapida (ambiente mockado)

1. Subir API mock (terminal em `mobile-app`):

```bash
npm run mock:api
```

2. Subir app em LAN para testes (terminal em `mobile-app`):

```bash
npm run start:e2e:lan
```

3. Rodar testes (terminal em `mobile-app`):

```bash
npm run e2e:mobile:smoke
```

## Comandos principais

- Todos os modulos E2E:

```bash
npm run e2e:mobile:all
```

- Apenas smoke:

```bash
npm run e2e:mobile:smoke
```

- Modulo especifico (`auth`, `profile`, `scheduling`, `regression`):

```bash
npm run e2e:mobile:module -- auth
```

- Modulo professional:

```bash
npm run e2e:mobile:professional
```

- Lotes por criticidade:

```bash
npm run e2e:mobile:batch:high
npm run e2e:mobile:batch:medium
npm run e2e:mobile:batch:low
```

- Lotes com relatorio/evidencias:

```bash
npm run e2e:mobile:batch:high:report
npm run e2e:mobile:batch:medium:report
npm run e2e:mobile:batch:low:report
```

- Execucao com relatorio/evidencias:

```bash
npm run e2e:mobile:report
```

Saidas de report ficam em `e2e/reports/run-<timestamp>/...`.

## Mapeamento completo de cenarios

- Catalogo completo (deslogado + logado por perfil + sistema):
  - `e2e/SCENARIO_CATALOG.md`
- Configuracao de lotes executaveis hoje:
  - `e2e/batches/implemented-flows-by-priority.json`

## Como adicionar novos testes

1. Crie um `.yaml` no modulo correto (ex.: `e2e/payments/`).
2. Use seletores estaveis via `testID` sempre que possivel.
3. Inclua cenarios positivos e negativos.
4. Adicione `takeScreenshot` nos pontos-chave do fluxo.
5. Execute via `npm run e2e:mobile:module -- <modulo>`.

## Ajustes de testabilidade aplicados

- `testID` nos campos/botoes de login e cadastro.
- `testID` padronizado na bottom nav (`nav.bottom.<key>`).
- `testID` de telas principais do cliente (home, promotions, training, profile, bookings).
- `testID` em card de agendamento e tela de detalhe do agendamento.

## Limitacoes atuais

- Fluxos de `scheduling/regression` com detalhe de agendamento assumem fixture da API mock (`booking-client-1`).
- Integracoes externas (pagamento real, upload real, camera nativa real) ainda estao planejadas para proxima fase.
- Para alta estabilidade em CI, recomenda-se build dedicada de teste com dados seedados.

## Proximos passos recomendados

- Seed de dados E2E dedicado para backend real (usuarios e agendamentos fixos).
- Cobertura de pagamentos, upload e permissoes nativas.
- Pipeline CI para executar `smoke` por commit e `regression` por merge/release.
