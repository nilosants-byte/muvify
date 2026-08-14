# Checklist de Validacao Automatizada E2E (MuviFy)

Data da execucao: 25/03/2026

Execucao consolidada final:

- `npm run qa:full` -> **PASS** (backend + smoke + docker tests + mobile typecheck/tests)

## Sequencia oficial automatizada

Comando unico:

```bash
npm run qa:full
```

O script `qa:full` executa, nessa ordem:

1. `npm run lint` (backend)
2. `npm run smoke:docker` (fluxo ponta a ponta de API)
3. `npm run test:docker` (suite backend com banco/redis isolados)
4. `npm --prefix mobile-app run typecheck`
5. `npm --prefix mobile-app run test -- --watch=false`

## Resultado da rodada atual

- Backend lint (`npm run lint`): **OK**
- Smoke Docker (`npm run smoke:docker`): **OK**
- Backend integracao Docker (`npm run test:docker`): **OK**
- Mobile typecheck (`npm run typecheck`): **OK**
- Mobile testes (`npm run test -- --watch=false`): **OK (20 suites, 42 testes)**

## Cobertura funcional validada automaticamente

### Autenticacao
- Registro de usuario (CLIENT/PROVIDER)
- Login
- Refresh token
- Logout
- Esqueci senha / reset senha

### Cliente
- Home + navegacao principal
- Busca e listagem de profissionais
- Favoritos (adicionar/remover)
- Criacao de agendamento
- Detalhe de agendamento
- Confirmacao de conclusao
- Avaliacao pos-conclusao
- Status de pagamento
- Fluxo de metodo de pagamento

### Profissional
- Home/agenda
- Detalhe de atendimento
- Confirmacao de conclusao
- Financeiro
- Conta bancaria (fluxo app)
- Disponibilidade semanal
- Fluxo de consultoria modular

### Validacao presencial (nova regra)
- Geracao de codigo de presenca
- Verificacao do codigo
- Fluxo de QR (token/deeplink e validacao)
- Conclusao condicionada a validacao presencial

### Plataforma
- Health check
- Docs (`/api/docs`)
- Notificacoes (registro/listagem/remocao de device)
- Fluxos de negocio criticos do backend em ambiente isolado (Postgres + Redis)

## Cenarios que ainda exigem validacao manual (recomendado)

1. Camera real do dispositivo (scan QR e captura selfie em hardware real)
2. UX visual em aparelhos fisicos (Android/iOS, tamanhos diferentes)
3. Notificacoes push fim-a-fim com token real de dispositivo
4. Mercado Pago real (ambiente de teste/homologacao) com webhooks externos e callbacks completos
5. Comportamento offline/reconexao com alternancia de rede real (Wi-Fi/dados)
6. Acessibilidade com leitor de tela real (TalkBack/VoiceOver) — sem ferramenta de lint madura pra
   React Native, esta e a unica forma de validar de verdade (ver checklist obrigatorio de release,
   `docs/RELEASE-READINESS-CHECKLIST.md`)

## Go/No-Go tecnico para avancar ao teste manual

Com base na execucao automatizada atual, o app esta em **GO para rodada manual final** focada em:

- Experiencia real no celular
- Permissoes nativas
- Validacao de usabilidade/fluxo completo em hardware real
