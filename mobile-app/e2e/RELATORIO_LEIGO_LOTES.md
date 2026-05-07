# Relatorio Simples - Testes em Lotes (E2E Mobile)

## 1) Em que fase estamos agora

- Ja existe uma base de automacao E2E pronta para uso.
- Os fluxos foram mapeados e priorizados em lotes.
- Parte dos cenarios ja foi automatizada.
- A execucao completa dos testes no aparelho ainda depende da instalacao do Maestro CLI no computador que vai rodar os testes.

Resumo simples:
- Preparacao: feita.
- Execucao: pronta para iniciar, faltando apenas o ambiente (Maestro + dispositivo/emulador).

## 2) O que cada lote testa

### Lote ALTA prioridade (critico para o negocio)

Objetivo:
- Garantir que o app nao quebre em fluxos essenciais.

Exemplos:
- Abrir app.
- Login.
- Cadastro.
- Fluxo principal de agendamento.
- Navegacao principal que impacta uso diario.

Risco se falhar:
- Usuario nao consegue entrar, usar ou concluir fluxo principal.

### Lote MEDIA prioridade (operacao importante)

Objetivo:
- Validar fluxos importantes, mas que nao bloqueiam 100% o app.

Exemplos:
- Recuperacao de senha (navegacao/validacoes basicas).
- Navegacao adicional por perfil.
- Fluxos de suporte operacional do dia a dia.

Risco se falhar:
- Experiencia ruim, retrabalho de suporte e queda de confianca.

### Lote BAIXA prioridade (refino e robustez)

Objetivo:
- Cobrir cenarios complementares e de acabamento.

Exemplos:
- Casos de borda menos frequentes.
- Ajustes de qualidade e estabilidade adicional.

Risco se falhar:
- Impacto menor no uso principal, mas gera perda de qualidade percebida.

## 3) Como ler o resultado de cada teste

Cada cenario tera:
- Status: `PASSOU` ou `FALHOU`.
- Evidencia: screenshot/log.
- Impacto: baixo, medio ou alto.
- Acao recomendada: como corrigir.

## 4) Modelo de relatorio apos execucao (preencher a cada rodada)

Data da rodada:
Ambiente:
Versao do app:
Lote executado:

| Cenario | Status | O que foi identificado | Impacto no usuario | Solucao recomendada | Responsavel | Prazo |
|---|---|---|---|---|---|---|
| Ex.: Login com campos vazios | PASSOU | Validacao exibida corretamente | Baixo | Nenhuma acao | QA | - |
| Ex.: Login com credenciais validas | FALHOU | App nao saiu da tela de login | Alto | Revisar resposta da API e tratamento de sessao | Dev Mobile + Backend | 24h |

## 5) Como transformar falha em plano de acao simples

Passo 1:
- Confirmar a falha com evidencia (print + log).

Passo 2:
- Classificar impacto:
  - Alto: bloqueia fluxo principal.
  - Medio: fluxo importante com contorno.
  - Baixo: detalhe sem bloqueio.

Passo 3:
- Definir acao de correcao:
  - Frontend (tela, validacao, navegacao).
  - Backend (contrato de API, regra de negocio, status).
  - Infra/ambiente (configuracao, permissao, conectividade).

Passo 4:
- Reexecutar lote afetado para validar correcao.

## 6) Comandos prontos para execucao em lotes

- Alta:
  - `npm run e2e:mobile:batch:high`
- Media:
  - `npm run e2e:mobile:batch:medium`
- Baixa:
  - `npm run e2e:mobile:batch:low`
- Com evidencias/relatorio:
  - `npm run e2e:mobile:batch:high:report`
  - `npm run e2e:mobile:batch:medium:report`
  - `npm run e2e:mobile:batch:low:report`
