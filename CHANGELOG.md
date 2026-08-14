# Changelog

Histórico de mudanças relevantes pro usuário final (cliente, personal trainer, admin) — pensado como
insumo pras notas de versão da App Store/Google Play, não como changelog técnico completo (esse vive
no `git log`).

Formato: cada entrada agrupa o que mudou de fato pra quem usa o app, não a lista de commits/lotes
internos. Datas aproximadas, baseadas no encerramento de cada frente do épico interno de auditoria
(`project_segunda_camada_epic.md`, memória do assistente — não versionado no repo).

O projeto ainda está em desenvolvimento, sem lançamento público nas lojas até o momento desta entrada
(ver `docs/RELEASE-READINESS-CHECKLIST.md`, seção de pré-submissão). Este changelog serve tanto de
registro interno quanto de rascunho pras primeiras notas de versão reais.

## Não lançado

### Confiabilidade e segurança
- Validação de presença por código/QR entre cliente e profissional agora tem cobertura automatizada de
  ponta a ponta — reduz risco de regressão numa regra criada pra evitar conclusão de atendimento sem
  presença real.
- Corrigido bug em que reabrir a tela de código de presença podia invalidar uma presença já confirmada.
- Corrigida inversão na lógica de pagamento de disputas de falta/prazo — em casos raros, o profissional
  podia deixar de receber ou o cliente deixar de ser reembolsado corretamente.
- Corrigidas condições de corrida em cancelar/concluir agendamento com duplo toque rápido.
- Corrigido cálculo de "quanto o profissional ganhou" — duas formas diferentes de calcular esse número
  coexistiam sem aviso, incluindo uma tela sobre Imposto de Renda que chamava valor bruto de "líquido".
- Corrigido saldo "Disponível para saque" que podia esquecer pagamentos antigos após ~3 semanas de uso.
- Corrigida perda silenciosa de dado de saúde (anamnese/avaliação física) ao editar ficha de aluno com
  vínculo antigo.
- Corrigida sobreposição de horário não detectada entre bloqueio manual e agendamento em alguns casos.
- Guarda de acesso administrativo centralizada — fechado um gap em que um e-mail de admin revogado
  ainda conseguia resolver disputa, dar baixa em dívida ou aprovar/reprovar CREF em módulos específicos.
- Exclusão de conta (LGPD) e exportação de dados pessoais ampliadas pra cobrir mais categorias de dado
  (consultoria, disputas, avaliação física, mídia órfã) que antes ficavam de fora.

### Pagamento e cobrança
- Corrigido combo com promoção ativa que exibia um preço na vitrine e cobrava outro no checkout
  (bloqueado até existir um jeito seguro de aplicar desconto em combo).
- Cobrança PIX de consultoria online passou a avisar o cliente de verdade quando fica pendente — antes,
  se o app fechasse antes do cliente pagar, o contrato podia expirar em 24h sem ninguém saber.
- Webhook de estorno (chargeback) do Mercado Pago corrigido para não ignorar silenciosamente casos de
  pacote presencial já pago.

### Acessibilidade
- Leitor de tela (TalkBack/VoiceOver) passou a anunciar corretamente campos de formulário, botão de
  voltar, toggles e botões só-ícone em dezenas de telas — antes, boa parte ficava muda ou repetia o
  mesmo anúncio genérico.
- Contraste de texto secundário/placeholder ajustado nos dois temas (claro/escuro) para atingir o
  mínimo recomendado de legibilidade.

### Desempenho e robustez
- Reduzido risco de o servidor cair inteiro por uma falha pontual em notificação ou evento de chat em
  tempo real — protegido na raiz, não só nos pontos já identificados.
- Adicionados limites de paginação em listas que podiam crescer sem teto (agenda, alunos, filas do
  admin), evitando lentidão progressiva com o tempo de uso.
- App mobile: virtualização de listas longas e cache de imagem mais consistente.

### Navegação e usabilidade
- Corrigida tela de configurações completas do profissional (incluinda excluir conta e baixar dados)
  que não tinha nenhum caminho de navegação até ela.
- Notificações push levam com mais precisão pra tela certa (pagamento, disputa, agendamento) em vez de
  cair sempre num destino genérico.
- Diversos textos, rótulos e menus revisados por consistência entre o fluxo presencial e o de
  consultoria online (antes divergiam em pontos que deveriam se comportar igual).

### Privacidade e conformidade
- Histórico de consentimento de termos/política passou a ser preservado (antes, um novo aceite
  sobrescrevia o registro anterior sem deixar rastro).
- Dados de saúde (anamnese, avaliação física) e dados bancários passaram a ser armazenados
  criptografados.
- PostHog (analytics) passou a exigir consentimento explícito antes de começar a coletar qualquer
  evento.

---

Entradas anteriores a este arquivo (épico de 12 frentes de regras de negócio/segurança concluído em
2026-07, incluindo o desenho original do produto) não têm changelog retroativo detalhado — consulte o
`git log` do período pra histórico completo.
