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
3. Preflight isolado (config + conectividade):
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

## Checklist obrigatorio (mobile)
1. `npm --prefix mobile-app run validate:release` verde.
2. Build EAS de homologacao concluido.
3. Rodada manual final em dispositivo fisico Android e iOS:
   - login/cadastro
   - 2FA
   - recuperacao de senha
   - agendamento
   - pagamento
   - notificacoes push
4. Politica de privacidade e declaracoes de loja revisadas.
5. Acessibilidade — rodada manual com leitor de tela ligado (TalkBack no Android, VoiceOver no iOS),
   pelo menos no fluxo de login/cadastro e num formulario critico (ex: anamnese ou criacao de ficha):
   - todo botao so-icone anuncia sua funcao (nao so "botao");
   - todo campo de formulario anuncia o rotulo correto ao ganhar foco;
   - erro de validacao e anunciado, nao so mostrado visualmente;
   - texto aumenta de tamanho quando a fonte do sistema e aumentada, sem cortar conteudo.
   (Nao existe ferramenta de lint de acessibilidade madura para React Native hoje — esta rodada manual
   e o unico gate real.)

## Go / No-Go
1. Go: todos os itens obrigatorios ok.
2. No-Go: qualquer item obrigatorio falho ou sem evidencia.

## Evidencias recomendadas
1. Link da pipeline CI verde.
2. Log do `release:preflight` no ambiente alvo.
3. Resultado do smoke pos-deploy.
4. Print ou ata da rodada manual mobile final.
5. Link para o runbook aplicado em incidente (quando houver): `docs/INCIDENT-RUNBOOK.md`.
