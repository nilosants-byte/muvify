# Rascunho — Google Play Data Safety Form

Rascunho pra preencher o formulário "Data Safety" do Play Console na hora da submissão. Baseado em
`docs/POLITICA-DE-PRIVACIDADE-v1.md` (fonte da verdade — se divergir, a política manda). Não é um
documento pra publicar, é insumo de trabalho.

**Antes de preencher de verdade:** confirme se o Play Console pede alguma coisa que mudou desde
2026-08-14 (a interface do formulário muda com frequência) e revise a seção 6 abaixo (gap identificado).

## 1. A app coleta ou compartilha algum dos tipos de dado do usuário?
**Sim.**

## 2. Todos os dados de usuário coletados são criptografados em trânsito?
**Sim** — toda a API roda em HTTPS/TLS.

## 3. A app oferece um jeito de o usuário pedir a exclusão dos dados?
**Sim** — dentro do app (Configurações → Excluir minha conta) e fora do app, por e-mail (ver
`docs/EXCLUSAO-DE-CONTA-PUBLICO.md`, publicada em `/excluir-conta`).

## 4. Mapeamento por categoria

| Categoria (Play Console) | Coletado? | Compartilhado com terceiro? | Opcional? | Finalidade | Fonte na política |
|---|---|---|---|---|---|
| **Localização precisa** | Sim (ambos os perfis, uso ativo) | Não | Sim (busca por distância exige, mas é opcional) | Funcionalidade do app | Cláusula 13.1 |
| **Localização aproximada** | Sim (profissional, localização fixa de atendimento) | Não | Não (profissional PROVIDER) | Funcionalidade do app | Cláusula 13.2 |
| **Localização em segundo plano** | Sim (só profissional, opt-in explícito) | Não | Sim | Funcionalidade do app | Cláusula 13.3 |
| **Nome** | Sim | Não | Não | Conta, identificação | 3.1 |
| **E-mail** | Sim | Não (só provedores de infra: SMTP) | Não | Conta, comunicação | 3.1 |
| **Número de telefone** | Sim | Não | Não | Conta, autenticação | 3.1 |
| **Endereço** | Não coletado como campo livre — só localização (ver acima) | — | — | — | — |
| **Outra info pessoal (CPF, foto de perfil)** | Sim | Não | Foto: sim / CPF: não | Antifraude, identificação | 3.1 |
| **Dados de saúde e fitness** (anamnese, avaliação física) | Sim (exclusivo do aluno) | Não | Não (pré-requisito pra contratar) | Funcionalidade do app | 4.2 — dado sensível, criptografado |
| **Dados financeiros** (conta bancária do profissional, método de pagamento do cliente, histórico de pagamento) | Sim | Sim — Mercado Pago (processamento de pagamento) | Não | Processamento de pagamento | 4.1, seção de compartilhamento com terceiros |
| **Mensagens** (chat de agendamento/consultoria) | Sim | Não | Não | Funcionalidade do app | 3.3 |
| **Fotos** (perfil, apresentação do profissional, selfie de presença, foto do feed) | Sim | Não (selfie de presença nunca é pública) | Foto de perfil/feed: sim / selfie de presença: não (é parte do fluxo) | Funcionalidade do app, verificação | 3.1, 3.2, 3.5 |
| **Vídeos** (vídeo de apresentação do profissional) | Sim | Não | Sim | Funcionalidade do app | 3.2 |
| **Arquivos e documentos** (comprovante CREF) | Sim (exclusivo do profissional) | Não | Não (obrigatório pra ativar serviços remunerados) | Verificação de credencial | 3.2 |
| **Atividade no app** (agendamentos, favoritos, avaliações, follows/feed, tickets de suporte) | Sim | Não | Varia por item | Funcionalidade do app | 3.3 |
| **Identificadores de dispositivo ou outros** (token push, plataforma, versão do app, nome do dispositivo) | Sim | Sim — provedor de push (Expo) | Não | Notificações, suporte técnico | 3.4 |
| **Info de app e performance** (crash/diagnóstico) | **Ver seção 6 abaixo — gap a resolver antes de preencher isso no Console** | — | — | — | — |
| **Histórico de navegação/pesquisa dentro do app** | Não aplicável (app nativo, não navegador) | — | — | — | — |
| **Contatos, calendário, áudio** | Não coletado | — | — | — | — |

## 5. Terceiros que recebem dado (pra seção "Data shared" do formulário)

| Terceiro | Dado recebido | Finalidade |
|---|---|---|
| Mercado Pago | Dados de pagamento (cartão tokenizado, PIX, dados bancários do profissional) | Processar pagamento e repasse |
| AWS S3 (armazenamento) | Fotos, vídeos, documentos, selfies — todos criptografados | Armazenamento de mídia |
| PostHog | ID do usuário, papel (aluno/profissional), eventos de navegação — **só com consentimento explícito, desligado por padrão** | Analytics de produto |
| Expo (push notifications) | Token de push, plataforma | Envio de notificação |
| Provedor de e-mail (SMTP) | E-mail, nome | Comunicação transacional |

## 6. Gap identificado — resolver antes de preencher o formulário de verdade

A Frente 13 (segunda camada, observabilidade) confirmou que o app mobile usa **Sentry** para
crash/error reporting (`mobile-app/src/observability/sentry.ts`, ativo quando `EXPO_PUBLIC_SENTRY_DSN`
está configurado). Isso não está listado na tabela de terceiros da política de privacidade
(`docs/POLITICA-DE-PRIVACIDADE-v1.md`, seção de compartilhamento) nem na tabela acima. Sentry
tipicamente coleta stack trace, tipo de dispositivo/OS e pode capturar contexto de requisição — precisa
decidir: (a) atualizar a política de privacidade pra listar o Sentry como terceiro, e (b) declarar
"Info de app e performance (crash logs)" como categoria coletada/compartilhada no formulário do Play
Console. Sem isso, o formulário fica incompleto e a política de privacidade tecnicamente omite um
processador de dados real.

_Rascunho gerado na Frente 17 (segunda camada, prontidão de lançamento), 2026-08-14._
