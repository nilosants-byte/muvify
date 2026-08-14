# Catalogo Completo de Cenarios E2E (Mapeamento)

Objetivo: mapear os cenarios E2E do app (deslogado e logado) e classificar por criticidade para execucao em lotes.

Legenda:
- Prioridade: `HIGH`, `MEDIUM`, `LOW`
- Status:
  - `AUTOMATIZADO` = possui flow E2E implementado hoje
  - `MAPEADO` = cenario mapeado e priorizado, pendente automacao

Frente 16 (segunda camada) consolidou duas arvores de flow paralelas (uma solta na raiz de
`e2e/`, outra em `e2e/maestro/`) numa unica, corrigiu testID/texto desatualizado nos flows
sobreviventes e adicionou os primeiros flows reais de dinheiro/dado sensivel (agendamento +
pagamento Pix, validacao presencial codigo/QR, exclusao de conta LGPD) — ver
`project_segunda_camada_epic.md` (memoria) pro raio-x completo. Um cenario que so existia na
arvore removida (GA-016) voltou a MAPEADO; esta tabela reflete o estado real pos-consolidacao,
nao a intencao original.

## 1) Fluxos Deslogado / Pre-Auth (GA-*)

| ID | Cenario | Prioridade | Status | Flow atual |
|---|---|---|---|---|
| GA-001 | App abre e chega no login | HIGH | AUTOMATIZADO | `e2e/smoke/01-app-launch.yaml` |
| GA-002 | Splash de lancamento durante boot | MEDIUM | MAPEADO | - |
| GA-003 | Bloqueio offline antes de autenticar | HIGH | MAPEADO | - |
| GA-004 | Login com sucesso como CLIENT | HIGH | AUTOMATIZADO | `e2e/auth/01-login-success.yaml` |
| GA-005 | Login com sucesso como PROVIDER | HIGH | AUTOMATIZADO | `e2e/professional/01-home-tabs.yaml` (login e pre-condicao do flow) |
| GA-006 | Login com sucesso como ADMIN | HIGH | AUTOMATIZADO | `e2e/admin/01-cref-validation.yaml` (login e pre-condicao do flow) |
| GA-007 | Login com campos obrigatorios vazios | HIGH | AUTOMATIZADO | `e2e/auth/02-login-empty-fields.yaml` |
| GA-008 | Login com credenciais invalidas | HIGH | AUTOMATIZADO | `e2e/auth/03-login-invalid-credentials.yaml` |
| GA-009 | Lembrar e-mail no login persiste apos reabrir | MEDIUM | MAPEADO | - |
| GA-010 | Navegacao Login -> Cadastro -> Login | MEDIUM | MAPEADO | - |
| GA-011 | Cadastro CLIENT com sucesso | HIGH | AUTOMATIZADO | `e2e/auth/04-register-success.yaml` |
| GA-012 | Cadastro PROVIDER com sucesso | HIGH | MAPEADO | - |
| GA-013 | Cadastro com campos obrigatorios vazios | HIGH | AUTOMATIZADO | `e2e/auth/05-register-validation.yaml` |
| GA-014 | Cadastro com email ja existente | HIGH | MAPEADO | - |
| GA-015 | Acesso a tela de recuperar senha | MEDIUM | AUTOMATIZADO | `e2e/auth/06-forgot-password.yaml` |
| GA-016 | Recuperar senha sem e-mail (validacao) | MEDIUM | MAPEADO | - (existia so na arvore removida na Frente 16; perdido na consolidacao) |
| GA-017 | Recuperar senha com e-mail valido | HIGH | MAPEADO | - |
| GA-018 | Redefinir senha com token valido | HIGH | MAPEADO | - |
| GA-019 | Redefinir senha com token invalido | HIGH | MAPEADO | - |
| GA-020 | SessionExpired redireciona para login | HIGH | MAPEADO | - |
| GA-021 | Selecao de perfil (CLIENT) apos autenticacao sem role | HIGH | MAPEADO | - |
| GA-022 | Selecao de perfil (PROVIDER) apos autenticacao sem role | HIGH | MAPEADO | - |
| GA-023 | Logout retorna para login | HIGH | MAPEADO | - (helper `_logout.yaml` existe pronto pra uso, mas nenhum flow o chama isoladamente hoje) |
| GA-024 | Sessao valida em storage pula tela de login | HIGH | MAPEADO | - |

## 2) Fluxos Logado - Cliente (CL-*)

| ID | Cenario | Prioridade | Status | Flow atual |
|---|---|---|---|---|
| CL-001 | Home cliente renderiza mapa e cards principais | HIGH | AUTOMATIZADO | `e2e/auth/01-login-success.yaml` |
| CL-002 | Permissao de localizacao concedida carrega mapa com centro atual | HIGH | MAPEADO | - |
| CL-003 | Permissao de localizacao negada usa fallback e app permanece funcional | HIGH | MAPEADO | - |
| CL-004 | Regra de raio no mapa: exibe apenas profissionais dentro do raio | HIGH | MAPEADO | - |
| CL-005 | Alterar raio expande/reduz lista de profissionais visiveis | HIGH | MAPEADO | - |
| CL-006 | Filtro por modo de atendimento no mapa | MEDIUM | MAPEADO | - |
| CL-007 | Filtro por especialidades no mapa | MEDIUM | MAPEADO | - |
| CL-008 | Busca por nome de profissional no mapa | MEDIUM | MAPEADO | - |
| CL-009 | Busca por localidade no mapa | MEDIUM | MAPEADO | - |
| CL-010 | Tap no marcador abre modal de resumo do profissional | HIGH | MAPEADO | - |
| CL-011 | Modal mostra disponibilidade semanal e detalhes por dia | MEDIUM | MAPEADO | - |
| CL-012 | Atalho de categoria leva para lista de profissionais | MEDIUM | MAPEADO | - |
| CL-013 | Tela Categories busca e seleciona especialidade | MEDIUM | MAPEADO | - |
| CL-014 | SearchProfessionals com filtros por texto/categoria | MEDIUM | MAPEADO | - |
| CL-015 | ProfessionalsList com filtros de distancia/rating/modo | MEDIUM | MAPEADO | - |
| CL-016 | ProfessionalDetail carrega dados, ofertas e midias | HIGH | MAPEADO | - |
| CL-017 | ConsultancyRequest cria solicitacao com sucesso | HIGH | MAPEADO | - |
| CL-018 | ArchivedRequests exibe e filtra historico | MEDIUM | MAPEADO | - |
| CL-019 | CreateBooking validacao de campos obrigatorios | HIGH | MAPEADO | - |
| CL-020 | CreateBooking sucesso com oferta padrao | HIGH | AUTOMATIZADO | `e2e/client/04-booking-payment-pix.yaml` |
| CL-021 | CreateBooking sucesso com oferta promocional | HIGH | MAPEADO | - |
| CL-022 | BookingConfirmation exibe id e dados do agendamento | HIGH | AUTOMATIZADO | `e2e/client/04-booking-payment-pix.yaml` |
| CL-023 | BookingPaymentStatus cartao (autorizado/capturado) | HIGH | MAPEADO | - (exige tokenizacao real no Mercado Pago; sem ambiente sandbox configurado) |
| CL-024 | BookingPaymentStatus pix (geracao qr/copia e cola) | HIGH | AUTOMATIZADO | `e2e/client/04-booking-payment-pix.yaml` (para na geracao da cobranca — captura real exige webhook do MP, ver limitacao no proprio flow) |
| CL-025 | ClientBookings lista agenda do cliente | HIGH | AUTOMATIZADO | `e2e/client/05-attendance-validation.yaml` |
| CL-026 | ClientBookingDetail abre dados de status/pagamento | HIGH | AUTOMATIZADO | `e2e/client/05-attendance-validation.yaml` |
| CL-027 | ClientBookingDetail atualiza codigo/QR de presenca | HIGH | AUTOMATIZADO | `e2e/client/05-attendance-validation.yaml` |
| CL-028 | ClientBookingDetail cancela agendamento | HIGH | MAPEADO | - |
| CL-029 | ClientBookingDetail confirma conclusao e navega para confirmacao | HIGH | MAPEADO | - |
| CL-030 | ClientConfirmCompletion fluxo de confirmacao final | HIGH | MAPEADO | - |
| CL-031 | ReviewProfessional envio de avaliacao | MEDIUM | MAPEADO | - |
| CL-032 | BookingChat envio/recebimento de mensagens | MEDIUM | MAPEADO | - |
| CL-033 | ClientPaymentMethod setup inicial de cliente de pagamento | HIGH | MAPEADO | - |
| CL-034 | ClientPaymentMethod adicionar cartao | HIGH | MAPEADO | - |
| CL-035 | ClientPaymentMethod definir cartao padrao | MEDIUM | MAPEADO | - |
| CL-036 | ClientPaymentMethod remover cartao | MEDIUM | MAPEADO | - |
| CL-037 | Promotions lista ofertas promocionais e combos | MEDIUM | MAPEADO | - |
| CL-038 | Promotions navega para detalhe/profissional e para booking | MEDIUM | MAPEADO | - |
| CL-039 | MyTraining estado bloqueado (sem contrato) | MEDIUM | MAPEADO | - |
| CL-040 | MyTraining estado ativo (planos e exercicios) | MEDIUM | MAPEADO | - |
| CL-041 | MyTraining aceitar proposta com metodo de pagamento | HIGH | MAPEADO | - |
| CL-042 | MyTraining recusar proposta | MEDIUM | MAPEADO | - |
| CL-043 | MyTraining timer de descanso e midia de exercicio | LOW | MAPEADO | - |
| CL-044 | Favorites listar/adicionar/remover | MEDIUM | MAPEADO | - |
| CL-045 | ClientProfile editar nome e persistir | MEDIUM | AUTOMATIZADO | `e2e/client/03-profile.yaml` |
| CL-046 | ClientProfile foto (camera/galeria/remover) | MEDIUM | MAPEADO | - |
| CL-047 | ClientSettings alterar preferencias e persistir | MEDIUM | MAPEADO | - |
| CL-048 | ClientAnamnesis salvar rascunho | MEDIUM | MAPEADO | - |
| CL-049 | ClientAnamnesis concluir formulario | HIGH | MAPEADO | - |
| CL-050 | Notifications cliente listar e marcar lidas | MEDIUM | MAPEADO | - |
| CL-051 | Support cliente enviar chamado | MEDIUM | MAPEADO | - |
| CL-052 | Privacy cliente abre corretamente | LOW | MAPEADO | - |
| CL-053 | Security cliente abre corretamente | LOW | MAPEADO | - |
| CL-054 | GenericError cliente fallback e recuperacao | MEDIUM | MAPEADO | - |
| CL-055 | Offline cliente bloqueio e recuperacao | HIGH | MAPEADO | - |
| CL-056 | Navegacao principal cliente (Home/Agenda/Treino/Comunidade/Perfil) | HIGH | AUTOMATIZADO | `e2e/client/01-home-tabs.yaml` |
| CL-057 | Exclusao de conta (LGPD) | HIGH | AUTOMATIZADO | `e2e/auth/07-delete-account.yaml` |

## 3) Fluxos Logado - Personal Trainer (PR-*)

| ID | Cenario | Prioridade | Status | Flow atual |
|---|---|---|---|---|
| PR-001 | Home do profissional carrega indicadores e atalhos | HIGH | AUTOMATIZADO | `e2e/professional/01-home-tabs.yaml` |
| PR-002 | Saudacao no topo e menu lateral funcional | MEDIUM | MAPEADO | - |
| PR-003 | Secao inline de area de atendimento aparece na home | HIGH | MAPEADO | - |
| PR-004 | Definir localizacao base por GPS | HIGH | MAPEADO | - |
| PR-005 | Definir localizacao base por busca de endereco | HIGH | MAPEADO | - |
| PR-006 | Alterar e salvar raio de atendimento | HIGH | MAPEADO | - |
| PR-007 | Alterar e salvar tipo de atendimento | HIGH | MAPEADO | - |
| PR-008 | Adicionar/remover locais adicionais | MEDIUM | MAPEADO | - |
| PR-009 | Mapa do personal segue padrao visual do cliente | MEDIUM | MAPEADO | - |
| PR-010 | ProfessionalAgenda abre e lista atendimentos | HIGH | AUTOMATIZADO | `e2e/professional/01-home-tabs.yaml`, `e2e/client/05-attendance-validation.yaml` |
| PR-011 | ProfessionalAgenda cria bloqueio manual de horario | MEDIUM | MAPEADO | - |
| PR-012 | ProfessionalAgenda remove bloqueio manual | MEDIUM | MAPEADO | - |
| PR-013 | AvailabilityManager cria disponibilidade | HIGH | MAPEADO | - |
| PR-014 | AvailabilityManager remove disponibilidade | MEDIUM | MAPEADO | - |
| PR-015 | BookingDetailProfessional exibe dados completos | HIGH | AUTOMATIZADO | `e2e/client/05-attendance-validation.yaml` |
| PR-016 | BookingDetailProfessional confirma atendimento | HIGH | MAPEADO | - |
| PR-017 | BookingDetailProfessional cancela atendimento | HIGH | MAPEADO | - |
| PR-017b | BookingDetailProfessional valida presenca por codigo (cliente gera, profissional digita) | HIGH | AUTOMATIZADO | `e2e/client/05-attendance-validation.yaml` |
| PR-018 | ProfessionalConfirmCompletion exige selfie de prova | HIGH | MAPEADO | - (camera real; sem automacao viavel sem hardware/emulador) |
| PR-019 | ProfessionalConfirmCompletion conclui com selfie valida | HIGH | MAPEADO | - (idem — testID e fallback de codigo manual ja prontos em `ProfessionalConfirmCompletionScreen`, faltando so a parte de camera) |
| PR-020 | BookingPaymentStatus profissional acompanha status financeiro | HIGH | MAPEADO | - |
| PR-021 | BookingChat profissional envia/recebe mensagens | MEDIUM | MAPEADO | - |
| PR-022 | ProfessionalConsultancyCenter abre e mostra painel | HIGH | AUTOMATIZADO | `e2e/professional/01-home-tabs.yaml` |
| PR-023 | ProfessionalConsultancyCenter habilita/desabilita consultoria | HIGH | MAPEADO | - |
| PR-024 | ProfessionalConsultancyCenter cria oferta com validacoes anti-fraude | HIGH | MAPEADO | - |
| PR-025 | ProfessionalConsultancyCenter responde solicitacoes ativas | HIGH | MAPEADO | - |
| PR-026 | ProfessionalArchivedRequests lista e filtra historico | MEDIUM | MAPEADO | - |
| PR-027 | TrainingCreation cria treino pre-pronto | HIGH | MAPEADO | - |
| PR-028 | TrainingCreation cria treino customizado para aluno/contrato | HIGH | MAPEADO | - |
| PR-029 | ProfessionalStudents abre dashboard por servico | HIGH | AUTOMATIZADO | `e2e/professional/01-home-tabs.yaml` |
| PR-030 | ProfessionalStudentDetail mostra anamnese, avaliacao e servicos | HIGH | MAPEADO | - |
| PR-031 | ProfessionalStudents auto-save da avaliacao fisica | MEDIUM | MAPEADO | - |
| PR-032 | PayoutStatus mostra estado da conta de recebimento | HIGH | MAPEADO | - |
| PR-033 | ConnectPayoutAccount gera link de onboarding de conta | HIGH | MAPEADO | - |
| PR-034 | ProfessionalFinancialDetails renderiza detalhes financeiros | MEDIUM | MAPEADO | - |
| PR-035 | PersonalFinance dashboard e CRUD financeiro (alunos/receitas/despesas/goals/sessoes) | HIGH | MAPEADO | - |
| PR-036 | ProfessionalCredentials upload CREF + docs frente/verso | HIGH | MAPEADO | - |
| PR-037 | ProfessionalCredentials status pendente/aprovado/reprovado | HIGH | MAPEADO | - |
| PR-038 | ProfessionalProfileEditor salvar dados obrigatorios | HIGH | MAPEADO | - (`e2e/professional/02-profile-editor.yaml` so abre a tela hoje, nao preenche/salva) |
| PR-039 | ProfessionalProfileEditor atualizar especialidades/categorias/preco | MEDIUM | MAPEADO | - |
| PR-040 | ProfessionalProfileEditor foto/video de apresentacao | MEDIUM | MAPEADO | - |
| PR-041 | ProfessionalSettings preferencias e persistencia | MEDIUM | MAPEADO | - |
| PR-042 | Notifications profissional listar/estado de leitura | MEDIUM | MAPEADO | - |
| PR-043 | Support profissional abre corretamente | LOW | MAPEADO | - |
| PR-044 | Privacy profissional abre corretamente | LOW | MAPEADO | - |
| PR-045 | Security profissional abre corretamente | LOW | MAPEADO | - |
| PR-046 | GenericError profissional fallback de erro | MEDIUM | MAPEADO | - |
| PR-047 | Offline profissional bloqueio e recuperacao | HIGH | MAPEADO | - |
| PR-048 | ServiceArea (rota dedicada legada) abre e salva configuracao | MEDIUM | MAPEADO | - |
| PR-049 | Popup de perfil incompleto (criar agora / lembrar depois) | MEDIUM | MAPEADO | - |
| PR-050 | Popup de CREF pendente (completar agora / lembrar depois) | MEDIUM | MAPEADO | - |
| PR-051 | Navegacao principal profissional (Home/Agenda/Consultoria/Alunos/Financeiro) | HIGH | AUTOMATIZADO | `e2e/professional/01-home-tabs.yaml` |
| PR-052 | Logout profissional retorna para login | HIGH | MAPEADO | - |
| PR-053 | Acessar ProfessionalHome via sessao persistida | HIGH | MAPEADO | - |
| PR-054 | Atendimento concluido reflete em agenda e financeiro | HIGH | MAPEADO | - |
| PR-055 | Regras de permissao sem profile: telas bloqueadas com CTA para perfil | HIGH | MAPEADO | - |

## 4) Fluxos Logado - Admin (AD-*)

| ID | Cenario | Prioridade | Status | Flow atual |
|---|---|---|---|---|
| AD-001 | Login admin com sucesso | HIGH | AUTOMATIZADO | `e2e/admin/01-cref-validation.yaml` (login e pre-condicao do flow) |
| AD-002 | Usuario sem role ADMIN nao acessa stack admin | HIGH | MAPEADO | - |
| AD-003 | AdminHome carrega overview e rankings | HIGH | AUTOMATIZADO | `e2e/admin/01-cref-validation.yaml` |
| AD-004 | AdminHome troca mes e atualiza metricas | MEDIUM | MAPEADO | - |
| AD-005 | AdminCrefValidation lista fila pendente/aprovada/reprovada | HIGH | AUTOMATIZADO | `e2e/admin/01-cref-validation.yaml` (so navega ate a tela, nao inspeciona a fila) |
| AD-006 | AdminCrefValidation aprovar CREF | HIGH | MAPEADO | - |
| AD-007 | AdminCrefValidation reprovar com justificativa | HIGH | MAPEADO | - |
| AD-008 | AdminSupport lista chamados e responde ticket | HIGH | MAPEADO | - |

## 5) Fluxos Cross / Sistema (SX-*)

| ID | Cenario | Prioridade | Status | Flow atual |
|---|---|---|---|---|
| SX-001 | OfflineRequired bloqueia app no inicio sem conexao | HIGH | MAPEADO | - |
| SX-002 | Reconexao apos offline recupera navegacao | HIGH | MAPEADO | - |
| SX-003 | Banner de conexao instavel em sessao ativa | MEDIUM | MAPEADO | - |
| SX-004 | Refresh token renova sessao sem logout | HIGH | MAPEADO | - |
| SX-005 | Refresh token invalido encerra sessao e limpa credenciais | HIGH | MAPEADO | - |
| SX-006 | Toasts de erro/sucesso aparecem em fluxos criticos | MEDIUM | MAPEADO | - |
| SX-007 | GenericError redireciona para rota segura | MEDIUM | MAPEADO | - |
| SX-008 | Deep link de reset-password com token preenche tela | MEDIUM | MAPEADO | - |
| SX-009 | Deep link de pagamento/agendamento abre destino correto | MEDIUM | MAPEADO | - |
| SX-010 | Tema dark/light persiste entre sessoes | LOW | MAPEADO | - |
| SX-011 | Internacionalizacao pt-BR em datas/moedas | LOW | MAPEADO | - |
| SX-012 | Acessibilidade basica (labels e foco) em auth/nav principal | MEDIUM | MAPEADO | - |
| SX-013 | Regressao de performance de abertura/telas criticas | LOW | MAPEADO | - |

## Execucao

Flows organizados por modulo (`smoke/`, `auth/`, `client/`, `professional/`, `admin/`), sem mais
sistema de lotes por prioridade (removido na Frente 16 junto com a arvore duplicada que o
mantinha). Ver `e2e/README.md` pros comandos (`npm run e2e:all`, `e2e:auth`, `e2e:client`, etc.).
