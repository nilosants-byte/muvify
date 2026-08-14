# Rascunho — Apple App Privacy (Nutrition Label)

Rascunho pra preencher a seção "App Privacy" no App Store Connect na hora da submissão. Baseado em
`docs/POLITICA-DE-PRIVACIDADE-v1.md` (fonte da verdade). Não é um documento pra publicar, é insumo de
trabalho — mesma base do `docs/GOOGLE-PLAY-DATA-SAFETY-DRAFT.md`, só reorganizada nas categorias que a
Apple usa (que não são idênticas às do Google).

**Rastreamento (tracking, no sentido do App Tracking Transparency da Apple):** o app **não** faz
tracking entre apps/sites de terceiros pra publicidade — PostHog é analytics de produto first-party
(com consentimento explícito), não repassa dado pra rede de anúncios. Resposta esperada: **"Data Is Not
Used to Track You"**.

## Mapeamento por categoria Apple

| Categoria Apple | Coletado? | Linked to user? | Finalidade (rótulo Apple) | Fonte |
|---|---|---|---|---|
| **Contact Info** (nome, e-mail, telefone) | Sim | Sim | App Functionality | 3.1 |
| **Health & Fitness** (anamnese, avaliação física) | Sim (só aluno) | Sim | App Functionality | 4.2 |
| **Financial Info** (dados bancários do profissional, método de pagamento, histórico) | Sim | Sim | App Functionality (processado via Mercado Pago) | 4.1 |
| **Location** (precisa, aproximada, background do profissional) | Sim | Sim | App Functionality | 13.1–13.3 |
| **Sensitive Info** | Ver Health & Fitness acima — CPF entra aqui também | Sim | App Functionality, antifraude | 3.1, 4.2 |
| **Contacts** | Não coletado | — | — | — |
| **User Content** (fotos, vídeos, mensagens de chat, avaliações) | Sim | Sim | App Functionality | 3.2, 3.3, 3.5 |
| **Browsing History** | Não aplicável | — | — | — |
| **Search History** (busca de profissionais dentro do app) | Sim, mas não persistido (cálculo em tempo real) | Não | — | 13.1 |
| **Identifiers** (ID de usuário, ID de dispositivo/push) | Sim | Sim | App Functionality, Analytics (PostHog, só com opt-in) | 3.4 |
| **Purchases** (histórico de pagamento de sessões/pacotes/consultoria) | Sim | Sim | App Functionality | 3.3 |
| **Usage Data** (eventos de navegação — só com consentimento) | Sim, opt-in | Sim (ID do usuário, não nome) | Analytics | Terceiros — PostHog |
| **Diagnostics** (crash/performance) | **Ver gap na seção final do `GOOGLE-PLAY-DATA-SAFETY-DRAFT.md`, item 6 — mesmo gap vale aqui** | — | — | — |
| **Other Data** | Não identificado nenhum adicional | — | — | — |

## Itens que a Apple pede além da tabela

1. **Privacy Policy URL**: precisa da URL pública — hoje não existe (ver
   `docs/RELEASE-READINESS-CHECKLIST.md`, seção "Pré-submissão às lojas"). A rota já está pronta em
   `/privacidade` no backend, só falta um domínio apontar pra ela.
2. **App Tracking Transparency (ATT) prompt**: como a resposta é "Data Is Not Used to Track You", o
   app **não precisa** mostrar o prompt de ATT (`NSUserTrackingUsageDescription`) — confirme que
   `app.json`/`Info.plist` não declara essa chave à toa (evita prompt desnecessário pro usuário).
3. **Purpose strings obrigatórias do iOS** — confirmadas em `mobile-app/app.json::plugins`, com texto
   específico (não genérico, o que a Apple exige pra passar review):
   - `expo-location`: `locationWhenInUsePermission` e `locationAlwaysAndWhenInUsePermission` — OK.
   - `expo-camera`: `cameraPermission` — OK. `microphonePermission: false` confirma que o app não usa
     microfone (nenhum `NSMicrophoneUsageDescription` necessário).
   - **Gap real encontrado e corrigido nesta frente:** o app usa `launchImageLibraryAsync` (seleção de
     foto da galeria) em 8 telas (`ClientProfileScreen`, `CommunityScreen`,
     `ProfessionalTrainingCreationScreen`, `MyTrainingScreen`, `ProfessionalProfileEditorScreen`,
     `ProfessionalCredentialsScreen`, `SelfieProofCapture`), mas `app.json::plugins` não tinha entrada
     pro plugin `expo-image-picker` com `photosPermission` customizado — só os plugins de
     location/camera tinham texto específico, sem isso o iOS usaria a string padrão genérica do pacote,
     exatamente o tipo de coisa que a revisão da Apple rejeita. Adicionado
     `["expo-image-picker", { "photosPermission": "..." }]` ao array de plugins.

_Rascunho gerado na Frente 17 (segunda camada, prontidão de lançamento), 2026-08-14._
