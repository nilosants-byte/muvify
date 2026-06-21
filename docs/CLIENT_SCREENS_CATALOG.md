# Catálogo de Telas — Tipo Cliente (Muvify)

> Uso: referência para redesign. Cada tela tem descrição visual + funcional.
> Organização: 7 tabs (navegação inferior) → stacks de fluxo (telas de detalhe/ação).

---

## SISTEMA DE DESIGN ATUAL

- **Fonte:** Syne (títulos), sistema (corpo)
- **Cores:** Verde primário `#4CAF50`, vermelho `#f44336`, azul `#2196F3`, laranja `#FF9800`
- **Modo:** Light/Dark via `MvThemeContext`
- **Espaçamento padrão:** 16px horizontal, 10–12px entre cards
- **Bordas:** radius 10–13px, `1px` com `theme.border`
- **Componentes base:** MvCard, MvButton, MvText, MvAvatar, MvBadge, MvInput, MvBottomNav

---

## PARTE 1 — TABS (Navegação Inferior)

São 7 abas na seguinte ordem: Início · Categorias · Promoções · Seu Treino · Agenda · Favoritos · Perfil

---

### TAB 1 — Home (`ClientHomeScreen`)

**Rota:** `ClientHome`

**Visual:**
- Header: saudação dinâmica (Bom dia/Boa tarde/Boa noite) + botão de notificações (sino) + botão de menu lateral (hambúrguer)
- Card topo: próximo agendamento (provider, data, status) + contador de sessões do mês
- Mapa interativo centralizado (react-native-maps) ocupando grande parte da tela com pins customizados de providers
- Barra de busca flutuando sobre o mapa: campo de texto + botão de filtros
- Filtros expansíveis: slider de raio (1–10km), modo de serviço (presencial/domicílio/ambos), chips de especialidade
- Grid de especialidades (4 colunas, abaixo do mapa) com ícones e nomes
- Drawer lateral de notificações (slide-in pela direita, vide `ClientNotificationsDrawer` abaixo)

**Funcional:**
- Pinos no mapa representam providers próximos; tap no pino abre o **Modal de Resumo do Provider** (vide abaixo)
- Busca por nome de provider (autocomplete) ou endereço (Google Places + Nominatim)
- Filtros alteram os providers exibidos no mapa em tempo real
- Grid de especialidades navega para listagem filtrada por categoria
- Ao carregar, checa anamnese do usuário e dispara o **Pop-up de Anamnese** (vide abaixo) uma vez por sessão

**Vai para:** `ProfessionalDetail`, `SearchProfessionals`, `CreateBooking`, `Notifications`

---

#### POP-UP: Anamnese (dentro da Home)

**Trigger:** Aparece automaticamente uma vez por sessão após carregamento da home. Dois estados possíveis:
- `incomplete` — ficha nunca preenchida ou incompleta
- `outdated` — ficha preenchida há mais de 6 meses

**Visual:**
- Overlay escuro semi-opaco cobrindo toda a tela (fundo `rgba(0,0,0,0.62)`)
- Card centralizado, bordas arredondadas (radius 20), borda verde sutil
- **Header do card** (fundo verde muito suave):
  - Ícone verde centralizado (56×56, radius 16): `pulse-outline` se incompleta / `clipboard-outline` se desatualizada
  - Título centralizado: "Preencha sua ficha de saúde" ou "Atualize sua ficha de saúde"
  - Subtítulo cinza: "Necessário para agendar com personais" ou "Última atualização há mais de 6 meses"
- **Corpo do card** (padding 20):
  - Texto explicativo centralizado (2 linhas)
  - Botão primário verde cheio: "Preencher ficha agora" ou "Atualizar ficha agora"
  - Botão secundário apenas texto, cinza: "Agora não" ou "Lembrar depois"
- Tap fora do card fecha o pop-up

**Funcional:**
- Botão primário: fecha pop-up e navega para `ClientAnamnesis`
- Botão secundário / tap fora: fecha pop-up sem ação (não reaparece na mesma sessão)

---

#### MODAL: Resumo do Provider (dentro da Home)

**Trigger:** Tap em um pin de provider no mapa.

**Visual:**
- Overlay escuro semi-opaco (`rgba(0,0,0,0.55)`) cobrindo toda a tela
- Card centralizado (width 100%, maxWidth 430, maxHeight 86%), bordas arredondadas (radius 16), 1px borda `theme.border`
- **Cabeçalho:** "Resumo do personal" + botão X (fecha)
- **Corpo scrollável:**
  - Avatar (68×68) + nome do provider + idade + preço por aula presencial (verde)
  - Vídeo de apresentação (height 170, radius 10) — se disponível
  - Card de especialidades: chips horizontais com wrap
  - Card de disponibilidade:
    - Calendário mini: navegação por semana (← →), dias clicáveis
    - Ao selecionar um dia: lista de horários disponíveis (chips verdes) e ocupados (chips vermelhos)
    - Texto orientativo se nenhum dia selecionado
- **Rodapé fixo:** Botão "Agendar" (largura total, verde)
- Tap fora do card fecha o modal

**Funcional:**
- Carrega detalhe do provider + preview de agenda (7 dias) em paralelo ao abrir
- Exibe skeleton/loading enquanto carrega
- "Agendar": fecha o modal e navega para `CreateBooking` com o `professionalId`

---

### TAB 2 — Categorias (`CategoriesScreen`)

**Rota:** `Categories`

**Visual:**
- Header: título "Especialidades"
- Input de busca com ícone de lupa
- Lista (`FlatList`) de cards de categoria com: ícone da especialidade, nome da categoria, texto "Ver profissionais"
- Estado vazio se busca não encontrar resultados

**Funcional:**
- Busca filtra a lista localmente (sem chamada de API — categorias fixas)
- Tap em qualquer card navega para a listagem de providers daquela categoria

**Vai para:** `ProfessionalsList` (com `categoryId`)

---

### TAB 3 — Promoções (`PromotionsScreen`)

**Rota:** `Promotions`

**Visual:**
- Card de estatísticas no topo: total de ofertas ativas, desconto médio (%), expirando em breve
- Tabs de filtro: Destaques · Promoções · Combos
- Lista de `OfferCard`s, cada um com:
  - Avatar + nome do provider + badge de especialidade
  - Título da oferta
  - Preço promocional (verde, destaque) + preço base riscado
  - Badge de % de desconto + badge "expira em X dias"
  - Dois botões: "Agendar agora" e "Ver profissional"

**Funcional:**
- Tabs filtram por tipo de oferta (PRESENTIAL, ONLINE_CONSULTANCY, COMBO)
- Ordenação por maior desconto
- "Agendar agora" → vai direto para tela de criação de agendamento com a oferta pré-selecionada
- "Ver profissional" → vai para o perfil completo do provider

**Vai para:** `CreateBooking` (com dados da oferta), `ProfessionalDetail`

---

### TAB 4 — Seu Treino (`MyTrainingScreen`)

**Rota:** `MyTraining`

**Visual:**
- Card de resumo: propostas pendentes, contratos ativos, aguardando entrega, tamanho da biblioteca de exercícios
- Badge de status (bloqueio/acesso restrito, se aplicável)
- Seção "Treino em preparo": cards de contratos aguardando entrega com deadline visível
- Seção "Propostas aguardando decisão": lista expansível, cada item mostra:
  - Texto de resposta do provider
  - Preço de contratação
  - Chips de método de pagamento (Crédito · Débito · PIX)
  - Botões "Aceitar e contratar" e "Recusar oferta"
- Tabs de filtro: Todos · Ativos · Entregues
- Cards de plano de treino, cada um com:
  - Título, nome do provider, badge de status, prazo de entrega
  - Lista de exercícios: nome, categoria, séries/reps, carga, tempo de descanso, botão de mídia
  - Botão de timer de descanso (abre modal de countdown)

**Funcional:**
- Aceitar proposta: seleciona método de pagamento e confirma contratação (debita o pagamento)
- Recusar proposta: arquiva o pedido
- Timer de descanso: countdown com efeito de piscar ao zerar
- Botão de mídia: abre visualizador de vídeo/imagem do exercício
- Filtros de tab afetam apenas a lista de contratos entregues

**Vai para:** `SearchProfessionals`, `ArchivedRequests`

---

### TAB 5 — Agenda (`ClientBookingsScreen`)

**Rota:** `ClientBookings`

**Visual:**
- Card de resumo: próximos agendamentos, pendentes, concluídos, preview do próximo
- Tabs de filtro: Próximos · Pendentes · Histórico · Todos
- Lista de cards de agendamento, cada um com:
  - Box de data (dia + mês abreviado, visual de calendário)
  - Avatar + nome do provider
  - Data e hora do agendamento
  - Badge de status (Confirmado · Pendente · Concluído · Cancelado)
  - Chevron indicando que é clicável

**Funcional:**
- Tabs filtram por status de agendamento
- Tap em card abre detalhe do agendamento
- Estado vazio com CTA para buscar profissional

**Vai para:** `ClientBookingDetail`, `SearchProfessionals`

---

### TAB 6 — Favoritos (`FavoritesScreen`)

**Rota:** `Favorites`

**Visual:**
- Lista simples de cards, cada um com:
  - Nome do provider
  - Bio truncada (2 linhas)
  - Badge de avaliação (estrela + nota)
  - Botão "Remover" (destrutivo)
- Estado vazio com mensagem incentivando a explorar profissionais

**Funcional:**
- Tap no card ou botão de ação: navega para perfil do provider
- "Remover": remove dos favoritos com confirmação imediata (sem modal)

**Vai para:** `ProfessionalDetail`

---

### TAB 7 — Perfil (`ClientProfileScreen`)

**Rota:** `ClientProfile`

**Visual:**
- Seção de avatar: foto circular editável (tap abre: câmera / galeria / remover)
- Nome editável inline (tap abre input de texto)
- Email (somente leitura)
- Indicador de completude do perfil
- Card de estatísticas: total de sessões, próximas, contratos ativos, contratos entregues
- Grid de ações rápidas (4 cards): Ficha de Saúde · Pagamento · Favoritos · Configurações

**Funcional:**
- Editar foto: abre picker nativo (câmera ou galeria), faz upload com base64
- Editar nome: input inline com salvar automático
- Cards de ação navegam para as respectivas telas

**Vai para:** `ClientAnamnesis`, `ClientPaymentMethod`, `Favorites`, `ClientSettings`

---

## PARTE 2 — STACK SCREENS (Fluxos de detalhe e ação)

---

### FLUXO DE DESCOBERTA

#### `SearchProfessionalsScreen`

**Visual:**
- Input de busca (auto-focado ao entrar na tela)
- Botão GPS com estado visual de ativo/inativo
- Chips de filtro horizontal: especialidade (Todas + categorias), nota mínima (4.0+ · 4.5+), modo de serviço
- Lista de sugestões em tempo real abaixo do input (aparece ao digitar)
- Botão fixo no rodapé: "Ver resultados"

**Funcional:**
- Busca com debounce (600ms) chama API de providers enquanto o usuário digita
- GPS: solicita permissão de localização, usa coordenadas para ordenar por distância
- Filtros acumulativos (pode combinar especialidade + nota + GPS)
- "Ver resultados" navega com todos os filtros ativos

**Vai para:** `ProfessionalsList`

---

#### `ProfessionalsListScreen`

**Visual:**
- Header: título dinâmico (query, categoria ou "Profissionais") + indicador "ordenado por distância" se GPS ativo
- Lista infinita (`FlatList`) de cards de provider:
  - Nome, bio truncada, badge de avaliação
  - Preço/sessão, distância (se GPS), modo de serviço
- Indicador de "Carregando mais..." no rodapé da lista
- Estado vazio com ícone e sugestão para remover filtros

**Funcional:**
- Paginação: 24 por vez, scroll até o fim carrega mais (`onEndReached`)
- Sem resultado: mostra estado vazio com CTA
- Tap no card navega para detalhe

**Vai para:** `ProfessionalDetail`

---

#### `ProfessionalDetailScreen`

**Visual:**
- Header com nome do provider (truncado) + botão de favoritar (coração)
- Seção hero: avatar grande, nome completo, especialidade/categoria, avaliação, preço por sessão
- Card "Sobre": bio completa
- Card "Valor por sessão": preço + badge "Pagamento seguro"
- Card "Ofertas em promoção" (condicional): lista de ofertas com preço promo vs original, botão "Escolher dias"
- Card "Consultoria online" (condicional): badge de disponibilidade, descrição, primeiras 2 ofertas, botão "Solicitar consultoria"
- Card "Avaliações recentes": últimas 2 avaliações com nome do avaliador, estrelas e comentário

**Funcional:**
- Favoritar: toggle com feedback imediato, persiste via API
- "Escolher dias": navega para criação de agendamento com oferta pré-selecionada
- "Solicitar consultoria online": navega para tela de pedido de consultoria

**Vai para:** `CreateBooking`, `ConsultancyRequest`

---

### FLUXO DE CONSULTORIA ONLINE

#### `ConsultancyRequestScreen`

**Visual:**
- Card informativo sobre como funciona a consultoria online
- Seção "Escolha o serviço": lista de ofertas do provider em formato rádio (uma selecionável), cada item mostra título, tipo, ciclo de cobrança e preço
- Seção "Briefing rápido" (expansível por pergunta):
  - "Qual tipo de treino você precisa?"
  - "Você tem alguma limitação?"
  - "Informações extras"
  - Cada pergunta tem input multiline (máx. 300 chars)
- Rodapé: resumo do serviço selecionado + botão "Enviar solicitação ao profissional"

**Funcional:**
- Seleção de serviço é obrigatória para habilitar o botão de envio
- Briefing é opcional mas incentivado
- Envio cria o pedido de consultoria na API e retorna para tela anterior

**Vai para:** (volta para a tela de origem)

---

### FLUXO DE AGENDAMENTO

#### `CreateBookingScreen`

**Visual:**
- Chips de categoria (Musculação, Funcional, etc.) — seleção do tipo de sessão
- Calendário mensal customizado: células por dia, dias disponíveis destacados, dias selecionados marcados com verde
- Navegação entre meses (← →)
- Ao selecionar um dia: slots de horário disponíveis aparecem abaixo
- Seção de datas/horários selecionados: lista das escolhas com chip de horário editável
- Seletor de local (Presencial · A domicílio · Personalizado)
- Input de observações (multiline)
- Aviso de anamnese desatualizada (se > 6 meses)
- Verificação de método de pagamento (aviso se não configurado)
- Seletor de forma de pagamento: chips Crédito · Débito · PIX
- Resumo de preço total
- Botão "Agendar"

**Funcional:**
- Calendário busca disponibilidade do provider por mês (uma chamada por mês navegado)
- Múltiplas datas podem ser selecionadas (cria múltiplos agendamentos)
- Agendamentos com oferta pré-carregada bloqueiam mudança de categoria e preço
- Anamnese desatualizada: aviso, mas não bloqueia
- Sem cartão: bloqueia pagamento por cartão, redireciona para cadastro
- PIX: gerado na próxima tela

**Vai para:** `BookingConfirmation`

---

#### `BookingConfirmationScreen`

**Visual:**
- Ícone de sucesso (check grande) + mensagem de confirmação
- Aviso parcial (se algumas datas falharam): "X de Y agendamentos criados"
- Card resumo: provider, data(s), horário, observações
- Card de status de pagamento com badge colorido (estado atual do pagamento)
- Explicação do método: cartão (pré-autorização → captura automática) ou PIX
- Para PIX: botão "Gerar cobrança PIX" → exibe QR code + botão copiar código
- Modal de chat (aparece automaticamente na primeira vez): incentiva enviar mensagem ao provider, com botões "Ir para o chat" e "Agora não"

**Funcional:**
- PIX: polling a cada 5s para detectar pagamento confirmado, atualiza badge automaticamente
- Modal de chat é exibido uma vez por agendamento (controlado por estado local)
- Botão principal após confirmação: "Ver minha agenda"

**Vai para:** `ClientBookings`, `ClientChatList`

---

### FLUXO DE DETALHE E CONCLUSÃO

#### `ClientBookingDetailScreen`

**Visual:**
- Card de status: data, horário, observações, badge de status
- Card de pagamento: valor, método, badge de status do pagamento, explicação
- Card de presença (condicional, se agendamento ativo/pendente):
  - QR code gerado dinamicamente
  - Token numérico (código de presença)
  - Tempo de expiração do código
  - Botão "Atualizar código/QR"
  - Texto explicando que o código libera 10 min antes do início
- Botão "Chat com o personal" (se chat ativo)
- Botão "Confirmar conclusão" (se agendamento ativo)
- Botão "Cancelar agendamento" (destrutivo, com confirmação)

**Funcional:**
- QR code usa deep link; token numérico é alternativa para scanning manual
- Código expira após janela de tempo configurável (padrão 6h)
- "Confirmar conclusão" → vai para captura de selfie
- "Cancelar": abre alert de confirmação antes de chamar API

**Vai para:** `ClientConfirmCompletion`, `ClientChatList`

---

#### `ClientConfirmCompletionScreen`

**Visual:**
- Card com info do agendamento (provider, categoria, data, local)
- Seção de validação de presença (igual ao detail: QR + código + expiração)
- Componente de selfie (`SelfieProofCapture`):
  - Preview de câmera ao vivo com botão de captura circular
  - Após captura: exibe a selfie + botões "Tirar novamente" e "Usar esta foto"
- Botão "Finalizar atendimento" (habilitado somente após selfie capturada)
- Botão "Voltar"

**Funcional:**
- Selfie é obrigatória para confirmar conclusão
- Ao finalizar: envia selfie (base64) + código de presença para a API
- Sucesso → navega para avaliação

**Vai para:** `ReviewProfessional`

---

#### `ReviewProfessionalScreen`

**Visual:**
- Seletor de estrelas 1–5 (grande, visual interativo, padrão 5)
- Input de comentário (multiline, máx. 500 chars, placeholder "Conte como foi sua sessão...")
- Texto informativo: "Sua avaliação fica disponível após conclusão do atendimento"
- Botão "Enviar avaliação"

**Funcional:**
- Avaliação é enviada para API e associada ao agendamento
- Após envio: navega para a aba de agenda

**Vai para:** `ClientBookings` (tab)

---

### FLUXO DE HISTÓRICO

#### `ArchivedRequestsScreen`

**Visual:**
- Tabs de filtro: Todos · Recusados · Expirados · Arquivados
- Lista de cards de pedido, cada um com:
  - Nome do provider, título da oferta
  - Data de atualização (formato relativo)
  - Badge de status
  - Resposta do provider (texto, se houver)

**Funcional:**
- Tabs filtram por status do pedido
- Somente leitura (sem ações disponíveis)

**Vai para:** (volta, sem destino de avanço)

---

### CONFIGURAÇÕES E CONTA

#### `ClientSettingsScreen`

**Visual:**
- Lista de linhas de configuração, cada uma com emoji + label:
  - Aparência → toggle light/dark
  - Notificações → toggle push on/off
  - Segurança → chevron (navegação)
  - Suporte → chevron (navegação)
  - Sair da conta → texto em vermelho (ação destrutiva)
- Sem header elaborado; tela simples e direta

**Funcional:**
- Toggle de aparência: muda tema globalmente em tempo real
- Toggle de notificações: habilita/desabilita push (persiste em AsyncStorage)
- "Sair da conta": abre alert de confirmação → faz logout (limpa tokens e sessão)

**Vai para:** `Security`, `Support`

---

#### `ClientAnamnesisScreen`

**Visual:**
- Formulário longo com seções claramente separadas:
  1. **Dados pessoais:** nome, data de nascimento, telefone, endereço, contato de emergência, gênero, peso, altura
  2. **Objetivos:** objetivo principal, prazo, objetivos secundários
  3. **Histórico de saúde:** perguntas booleanas (doença crônica, cirurgia, lesão, dor, cardíaco, hipertensão, diabetes, respiratório)
  4. **Medicamentos/suplementos:** uso atual, com campo de detalhe se sim
  5. **Histórico de atividade:** já treinou, suporte profissional, tempo treinando, frequência, modalidades, motivo de parada
  6. **Estilo de vida:** qualidade do sono, estresse, álcool, rotina de trabalho, tabagismo, horas de sono
  7. **Nutrição:** dieta atual, compulsão alimentar, refeições/dia, consumo de água, alimentos evitados
  8. **Limitações:** limitações físicas, exercícios restritos
  9. **Comportamento:** motivação para treinar, dificuldades de consistência, motivo de abandono
  10. **PAR-Q:** 6 perguntas padrão de segurança pré-exercício
  11. **Autorização de imagem:** checkbox de consentimento
- Cada seção tem título destacado
- Campos obrigatórios marcados

**Funcional:**
- Validação ao enviar: verifica todos os campos obrigatórios (campos de texto + booleans)
- Campos booleanos "sim" revelam inputs de detalhe adicionais
- Envio: chama API para salvar/atualizar anamnese do usuário

**Vai para:** (volta para a tela de origem)

---

#### `ClientPaymentMethodScreen`

**Visual:**
- Badge de status no topo: "Configurado" (verde) ou "Pendente" (cinza)
- Formulário de cartão:
  - Número do cartão (formatação automática: espaço a cada 4 dígitos)
  - Validade (MM/AA)
  - CVV
  - Nome do titular
  - CPF (formatação: 000.000.000-00)
  - Apelido do cartão (opcional)
- Botão "Adicionar cartão" ou "Atualizar cartão" (muda conforme estado)

**Funcional:**
- Fluxo: busca public key do Mercado Pago → tokeniza cartão via SDK do MP → salva token na API do app
- Dados do cartão nunca são enviados diretamente para o backend do app (PCI compliance)
- Formatação de input é em tempo real (máscara)
- Se já tem cartão: campos pré-preenchidos com dados mascarados

**Vai para:** (volta para o Perfil)

---

### NOTIFICAÇÕES

#### `NotificationsScreen` *(tela completa — shared)*

**Rota:** `Notifications` (stack compartilhado entre CLIENT e PROVIDER)
**Abertura:** Botão de sino no header da Home navega para esta tela via stack

**Visual:**
- **Header fixo:**
  - Botão de voltar (chevron, radius 10, fundo `theme.backBtn`)
  - Título "Notificações" + badge dinâmico: "X nova(s)" (azul/laranja) ou "Em dia" (cinza)
  - Botão lixeira (aparece só quando há notificações) para limpar tudo
- **Lista principal (`FlatList`, pull-to-refresh verde):**
  - **Card especial — BOOKING_CREATED (cliente):** borda e ícone verdes; linha com avatar-ícone, título, corpo, timestamp, badge "Novo"; abaixo: botões "Abrir Conversas" (verde cheio) + "Ver Agendamento" (outline verde)
  - **Card especial — BOOKING_CREATED (provider):** borda azul; mesma estrutura + linha adicional com status da ficha de saúde do aluno (texto colorido: verde/laranja/cinza); botões "Conversas" (azul cheio) + "Ficha do Aluno" (outline azul) + "Detalhes" (outline cinza)
  - **Card padrão (todas as outras notificações):** ícone quadrado (36×36, radius 10, `theme.chipBg`) com Ionicon colorido por categoria + título em negrito + corpo + timestamp + badge "Novo"/"Lido" + chevron; card inteiro clicável
  - Cards lidos aparecem com opacidade 0.78–0.82
- **Estado vazio:** ícone sino grande + "Nenhuma notificação encontrada."
- **Rodapé:** botão "Atualizar" (borda sutil, ícone refresh, texto muda para "Atualizando..." durante carga)

**Fontes de notificações (mescladas e ordenadas por data desc):**
1. **Config:** verificação de cartão de pagamento não configurado → card "Configuração pendente" (laranja), navega para `ClientPaymentMethod`
2. **Market:** busca providers no raio salvo do usuário + catálogos de ofertas → gera itens "Promoção perto de você" (verde) e "Novo serviço no seu raio" (azul), navega para tab Promoções
3. **Inbox:** notificações do backend (push recebidas); ícone e cor determinados pelo tipo do evento (`booking_*`, `payment_*`, `consultancy_*`, `chat_*`, etc.)
4. **Booking fallback:** se o inbox não tiver contexto de agendamento, gera itens a partir dos últimos 12 bookings do usuário (Pendente → laranja, Confirmado → verde, Cancelado → vermelho, Concluído → azul)

**Ações ao clicar (roteamento por tipo):**
- `BOOKING_DETAIL` → `ClientBookingDetail`
- `BOOKING_CHAT` → `ClientChatList`
- `BOOKING_PAYMENT_STATUS` → `BookingPaymentStatus` ou `ClientPaymentMethod`
- `CLIENT_BOOKINGS` → tab `ClientBookings`
- `CLIENT_TRAINING` → tab `MyTraining`
- `CLIENT_ARCHIVED_REQUESTS` → `ArchivedRequests`
- `CLIENT_PROMOTIONS` → tab `Promotions`
- `CLIENT_PAYMENT_METHOD` → `ClientPaymentMethod`
- `SUPPORT` → `Support`

**Vai para:** múltiplos destinos conforme tipo de notificação (ver acima)

---

#### `ClientNotificationsDrawer` *(componente drawer — dentro da Home)*

**Trigger:** Botão de sino no header da Home (não navega, desliza sobre a tela atual)

**Visual:**
- Painel animado que desliza da direita sobre a home (não substitui a tela)
- Lista de cards de notificação simplificados: título, subtítulo/corpo, dados adicionais, timestamp, botão "X" por item
- Badge de não lidas no botão sino do header da home (indicador numérico)

**Funcional:**
- Versão resumida das notificações (sem lógica de mercado/config — apenas inbox + bookings)
- IDs descartadas persistem em AsyncStorage
- Fecha ao tocar fora do painel ou no X de item

> **Nota de arquitetura:** o sino na home abre o `ClientNotificationsDrawer` (slide-in, sem navegação). A tela completa `NotificationsScreen` é acessada via rota `Notifications` — atualmente não há botão "Ver todas" conectando os dois; são entradas independentes.

---

### COMUNICAÇÃO

#### `ClientChatListScreen`

**Visual (visão de lista):**
- Tabs: Ativos · Inativos
- Cards de conversa, cada um com:
  - Avatar do provider (com iniciais se sem foto)
  - Nome do provider
  - Última mensagem (truncada, 1 linha)
  - Badge de não lidas (número, círculo verde)
  - Tempo relativo (há X min, hoje, data)

**Visual (visão de chat aberto):**
- Header: avatar + nome do provider + botão de voltar para lista
- `FlatList` de mensagens (mais antigas acima, mais novas abaixo)
- Mensagens do cliente: balão à direita, fundo verde/primário
- Mensagens do provider: balão à esquerda, fundo neutro
- Timestamp abaixo de cada mensagem
- Input fixo no rodapé + botão de enviar

**Funcional:**
- Lista: polling a cada 3s para atualizar conversas e badges de não lidas
- Chat: polling a cada 3s para novas mensagens (sem WebSocket)
- Envio: otimista (mensagem aparece imediatamente, confirmada pela próxima poll)
- Tabs filtram chats por estado (ativo = agendamento em aberto)

**Vai para:** (sem destino de avanço — tela terminal)

---

#### `ClientNotificationsDrawer` *(componente, não tela full)*

**Visual:**
- Painel animado que desliza da direita (sobrepõe a home)
- Lista de cards de notificação, cada um com:
  - Título em negrito
  - Subtítulo/corpo
  - Dados adicionais (ex: nome do provider, valor)
  - Timestamp
  - Botão "X" para fechar/descartar notificação individual

**Funcional:**
- Abre ao tocar no sino do header da Home
- Auto-marca como lidas quando visíveis
- IDs de notificações descartadas persistem em AsyncStorage
- Polling junto com a home (não tem polling próprio)

---

## RESUMO DE FLUXOS PRINCIPAIS

| Fluxo | Telas envolvidas |
|---|---|
| Descoberta → Agendamento | Home → ProfessionalDetail → CreateBooking → BookingConfirmation |
| Busca filtrada | Categories / Home → SearchProfessionals → ProfessionalsList → ProfessionalDetail |
| Conclusão de sessão | ClientBookingDetail → ClientConfirmCompletion → ReviewProfessional |
| Consultoria online | ProfessionalDetail → ConsultancyRequest → MyTraining (proposta) → aceite |
| Gestão de conta | Profile → Settings / Anamnesis / PaymentMethod |
| Comunicação | (qualquer tela de agendamento) → ClientChatList |

---

## CONTAGEM DE TELAS

| Tipo | Quantidade |
|---|---|
| Tabs (navegação inferior) | 7 |
| Stacks de fluxo | 15 |
| Telas shared (cliente usa) | 1 (`NotificationsScreen`) |
| Pop-ups / modais da Home | 2 (anamnese + resumo do provider) |
| Drawer da Home | 1 (`ClientNotificationsDrawer`) |
| **Total navegável** | **23** |
| **Total incluindo overlays** | **26** |
