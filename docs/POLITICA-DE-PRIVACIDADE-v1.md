# POLÍTICA DE PRIVACIDADE — MUVIFY
**Versão:** 1.0  
**Data de vigência:** [DATA DE PUBLICAÇÃO]  
**Última atualização:** [DATA DE PUBLICAÇÃO]

---

> **NOTA PARA O OPERADOR:** Antes de publicar, preencha todos os campos marcados com `[colchetes]`. Consulte seu advogado para revisar cláusulas específicas do seu modelo de negócio.

---

## PREÂMBULO

Esta Política de Privacidade ("Política") descreve como a **[RAZÃO SOCIAL DA EMPRESA]**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº **[CNPJ]**, com sede na **[ENDEREÇO COMPLETO]**, CEP **[CEP]**, doravante denominada **"Muvify"**, **"nós"** ou **"Controladora"**, coleta, usa, armazena, compartilha e protege os dados pessoais dos usuários do aplicativo móvel **Muvify** (doravante "Aplicativo"), em estrita conformidade com a **Lei nº 13.709/2018 – Lei Geral de Proteção de Dados Pessoais ("LGPD")**, o **Marco Civil da Internet (Lei nº 12.965/2014)**, o **Código de Defesa do Consumidor (Lei nº 8.078/1990)** e demais normas aplicáveis.

A Muvify atua como **controladora dos dados pessoais** na acepção do art. 5º, VI da LGPD, determinando as finalidades e os meios de tratamento dos dados que coleta de seus usuários.

Ao criar uma conta, acessar o Aplicativo ou utilizar qualquer de nossos serviços, você declara ter lido integralmente este documento, compreendido seus termos e manifestado seu consentimento livre, informado e inequívoco ao tratamento dos seus dados pessoais nas condições aqui descritas.

---

## ÍNDICE

1. [Definições](#1-definições)
2. [Quem É o Usuário — Perfis de Conta](#2-quem-é-o-usuário--perfis-de-conta)
3. [Dados Pessoais Coletados](#3-dados-pessoais-coletados)
4. [Dados Pessoais Sensíveis](#4-dados-pessoais-sensíveis)
5. [Finalidades e Bases Legais do Tratamento](#5-finalidades-e-bases-legais-do-tratamento)
6. [Compartilhamento de Dados com Terceiros](#6-compartilhamento-de-dados-com-terceiros)
7. [Transferência Internacional de Dados](#7-transferência-internacional-de-dados)
8. [Retenção e Descarte de Dados](#8-retenção-e-descarte-de-dados)
9. [Medidas de Segurança](#9-medidas-de-segurança)
10. [Direitos do Titular](#10-direitos-do-titular)
11. [Consentimento e Revogação](#11-consentimento-e-revogação)
12. [Uso por Menores de Idade](#12-uso-por-menores-de-idade)
13. [Dados de Geolocalização](#13-dados-de-geolocalização)
14. [Notificações e Comunicações](#14-notificações-e-comunicações)
15. [Incidentes de Segurança](#15-incidentes-de-segurança)
16. [Encarregado de Proteção de Dados (DPO)](#16-encarregado-de-proteção-de-dados-dpo)
17. [Alterações nesta Política](#17-alterações-nesta-política)
18. [Legislação Aplicável e Foro](#18-legislação-aplicável-e-foro)

---

## 1. DEFINIÇÕES

Para os fins desta Política, adotam-se as definições do art. 5º da LGPD e as seguintes:

| Termo | Definição |
|---|---|
| **Dado pessoal** | Informação relacionada a pessoa natural identificada ou identificável |
| **Dado pessoal sensível** | Dado sobre origem racial ou étnica, convicção religiosa, opinião política, filiação sindical, saúde, vida sexual, dado genético ou biométrico — art. 5º, II da LGPD |
| **Titular** | Pessoa natural a quem se referem os dados pessoais |
| **Controladora** | Muvify — decide as finalidades e os meios do tratamento |
| **Operadora** | Pessoa jurídica que trata dados em nome da Controladora (ex.: Mercado Pago, Expo, AWS) |
| **Encarregado / DPO** | Pessoa indicada pela Controladora para atuar como canal de comunicação entre Controladora, titulares e ANPD |
| **Tratamento** | Toda operação realizada com dados pessoais: coleta, armazenamento, uso, compartilhamento, exclusão etc. |
| **Consentimento** | Manifestação livre, informada e inequívoca do titular concordando com tratamento específico de seus dados |
| **ANPD** | Autoridade Nacional de Proteção de Dados |
| **Aluno / CLIENT** | Usuário cadastrado como cliente que contrata serviços de personal trainer |
| **Profissional / PROVIDER** | Profissional de educação física (personal trainer) cadastrado para ofertar serviços |
| **Anamnese** | Questionário clínico-funcional de saúde aplicado ao aluno antes do início dos treinos |

---

## 2. QUEM É O USUÁRIO — PERFIS DE CONTA

O Aplicativo Muvify opera como um **marketplace de serviços de personal trainer** com dois perfis de conta distintos, cada um com finalidades e dados coletados específicos:

### 2.1 Aluno (CLIENT)
Pessoa natural que utiliza o Aplicativo para buscar, contratar e acompanhar serviços de profissionais de educação física. Pode contratar sessões presenciais (agendamentos), planos de treino online e consultorias.

### 2.2 Profissional (PROVIDER)
Profissional de educação física detentor de registro ativo no **Conselho Regional de Educação Física ("CREF")** que utiliza o Aplicativo para ofertar e prestar serviços, gerenciar agenda, receber pagamentos e conduzir treinos e consultorias. O cadastro como PROVIDER exige a comprovação documental do CREF, sem a qual os serviços remunerados são bloqueados pela plataforma.

---

## 3. DADOS PESSOAIS COLETADOS

### 3.1 Dados fornecidos diretamente pelo usuário no cadastro (ambos os perfis)

| Dado | Obrigatório? | Finalidade imediata |
|---|---|---|
| Nome completo | Sim | Identificação e exibição no perfil |
| Endereço de e-mail | Sim | Autenticação, comunicações, recuperação de conta |
| Senha | Sim | Autenticação (armazenada exclusivamente em hash bcrypt 12 rounds — nunca em texto claro) |
| Número de telefone | Sim | Comunicação e autenticação secundária |
| CPF (documento) | Sim | Identificação fiscal e antifraude |
| Nome de usuário (username) | Sim | Identificação pública no perfil |
| Foto de perfil | Não | Personalização e identificação visual |

### 3.2 Dados adicionais do perfil — exclusivos do Profissional (PROVIDER)

| Dado | Descrição |
|---|---|
| Nome profissional (display name) | Nome exibido publicamente no marketplace |
| Biografia profissional | Texto descritivo de até 1.000 caracteres |
| Anos de experiência | Informação de currículo (0 a 75 anos) |
| Valor dos serviços | Preço por sessão em centavos |
| Modalidades e categorias atendidas | Tipos de treino oferecidos |
| Foto de apresentação | Imagem pública do profissional |
| Vídeo de apresentação | Vídeo público de apresentação (até 40 MB) |
| Número de registro no CREF | Obrigatório para ativação dos serviços remunerados |
| Documentos comprobatórios do CREF | Arquivos enviados para validação administrativa |
| Dados bancários para recebimento | Vide item 4.1 — dados sensíveis criptografados |

### 3.3 Dados gerados automaticamente pelo uso do Aplicativo

| Dado | Descrição |
|---|---|
| Identificadores de sessão | Tokens de autenticação JWT (refresh tokens armazenados com expiração) |
| Tokens de recuperação de senha | Hash do token, nunca o token em texto claro |
| Token de verificação de e-mail | Hash do token de confirmação de e-mail |
| Histórico de agendamentos (Bookings) | Data, horário, status, valor, profissional contratado, código de presença |
| Histórico de pagamentos | Método, valor, status, identificadores do processador de pagamento |
| Mensagens de chat | Mensagens trocadas em contexto de agendamento ou consultoria |
| Avaliações e comentários | Estrelas e texto de review de sessões |
| Planos de treino e exercícios | Planos criados pelo profissional e associados ao aluno |
| Notificações in-app | Registro de notificações enviadas e lidas |
| Atividade social | Follows, seguidores, feed de evolução, conquistas (achievements) |
| Favoritos | Profissionais favoritados pelo aluno |
| Tickets de suporte | Mensagens enviadas ao suporte via aplicativo |
| Relatos de falta e casos de disputa | Motivo do relato/contestação de falta de comparecimento, nota de contexto e motivo da decisão do administrador em casos de disputa (item 10.5.2 dos Termos de Uso) |

### 3.4 Dados coletados automaticamente pelo dispositivo

| Dado | Descrição |
|---|---|
| Token push (Expo) | Identificador único do dispositivo para envio de notificações push |
| Plataforma | iOS, Android, Web ou desconhecida |
| Versão do aplicativo | Controle de compatibilidade e suporte |
| Nome do dispositivo | Identificação de dispositivos ativos (ex.: "iPhone de João") |
| Data/hora do último acesso do dispositivo | Gestão de sessões e dispositivos inativos |

### 3.5 Dados de evidência de presença e fotos de treino no feed

**Selfie de comprovação de presença (sessões presenciais):** ao concluir sessões presenciais, o Aplicativo captura uma **selfie do aluno** (imagem fotográfica) como comprovante de presença. Dados coletados:

- Imagem em formato digital (JPEG, PNG ou similar, validado por MIME type)
- Câmera utilizada (frontal ou traseira)
- Data e hora da captura

Essa selfie é armazenada de forma criptografada e destinada, em regra, exclusivamente a comprovar a realização da sessão. Excepcionalmente, ela pode ser **acessada por um administrador da Muvify**, exclusivamente no contexto de uma análise manual de disputa (por exemplo, quando uma das partes contesta um relato de falta de comparecimento — item 10.5.2 dos Termos de Uso), nunca para qualquer outra finalidade.

**Foto opcional no feed de evolução (presencial e treino online):** ao concluir uma sessão presencial ou um treino de uma ficha de consultoria online, o Aplicativo pergunta ao Aluno se deseja publicar uma foto no feed de evolução, para fins de engajamento social e gamificação — funcionalidade **totalmente opcional, nunca obrigatória para concluir a sessão ou o treino**. Caso o Aluno autorize:

- No treino **presencial**, é gerada uma **cópia separada e não criptografada** da imagem, exclusivamente para essa publicação — a selfie de comprovação de presença (criptografada, de uso interno) nunca é publicada diretamente nem reaproveitada automaticamente para essa finalidade;
- No treino **online** (consultoria), como não existe selfie de comprovação de presença nesse fluxo, o Aplicativo abre a câmera do celular no momento da conclusão para capturar uma foto especificamente para essa publicação.

Em qualquer dos dois casos, a foto publicada é pública (visível a quem segue o perfil do Aluno) e passa a ser conteúdo gerado pelo usuário, sujeito às mesmas regras da Cláusula 15 dos Termos de Uso. Caso o Aluno não autorize, nenhuma foto é enviada ou publicada.

---

## 4. DADOS PESSOAIS SENSÍVEIS

O Aplicativo Muvify trata as seguintes categorias de dados pessoais sensíveis, conforme o art. 5º, II da LGPD, com base legal exclusivamente no **consentimento específico e destacado do titular** (art. 11, I da LGPD) ou, quando aplicável, na **tutela da saúde** do titular (art. 11, II, "f" da LGPD):

### 4.1 Dados Financeiros e Bancários (exclusivo do Profissional/PROVIDER)

Os dados bancários dos profissionais são tratados como dados sensíveis em razão de sua natureza patrimonial e risco de uso indevido. Todos os campos a seguir são **armazenados com criptografia AES-256**, utilizando chave exclusiva de produção (`APP_ENCRYPTION_KEY`), **nunca em texto claro**:

- Nome do banco
- Tipo de conta (corrente ou poupança)
- Agência e número da conta com dígito verificador
- Nome completo do titular da conta
- CPF ou CNPJ do titular da conta
- Chave PIX (quando fornecida)
- Identificador da conta no Mercado Pago (mpAccountId)

### 4.2 Dados de Saúde — Anamnese (exclusivo do Aluno/CLIENT)

A anamnese é um questionário clínico-funcional preenchido pelo aluno **com consentimento específico e destacado**, cujo tratamento tem a finalidade exclusiva de permitir que o profissional de educação física personalize os treinos com segurança. As informações coletadas incluem:

**Dados pessoais complementares:**
- Data de nascimento e idade
- Sexo biológico
- Peso e altura atuais
- Endereço residencial
- Contato de emergência (nome e telefone)

**Histórico de saúde:**
- Doenças diagnosticadas (ex.: diabetes, hipertensão, problemas cardíacos)
- Cirurgias realizadas
- Lesões e dores existentes
- Uso atual de medicamentos e suplementos (com descrição)
- Histórico familiar de doenças cardíacas, hipertensão, diabetes, obesidade e problemas ortopédicos
- Problemas respiratórios

**PAR-Q (Physical Activity Readiness Questionnaire):**
- Sete perguntas clínicas sobre risco cardiovascular antes do início de atividade física

**Objetivos de treino:**
- Emagrecimento, hipertrofia, condicionamento físico, reabilitação, performance esportiva ou saúde geral

**Estilo de vida:**
- Horas e qualidade do sono
- Nível de estresse (baixo, moderado ou alto)
- Consumo de álcool (não, social ou frequente)
- Tabagismo
- Rotina de trabalho (sedentária, moderadamente ativa ou muito ativa)
- Refeições por dia, adesão a dieta, consumo de água, compulsão alimentar e alimentos evitados

**Atividade física prévia:**
- Duração e frequência de prática anterior
- Modalidades praticadas
- Limitações físicas e restrições de exercício

**Autorização de imagem:**
- Consentimento para uso de imagens do aluno (ex.: fotos de progresso) — campo `allowImageUse` (boolean)

### 4.3 Avaliações Biométricas (geradas pelo Profissional após sessões)

| Dado | Tipo |
|---|---|
| Peso | Numérico (string) |
| Altura | Numérico |
| Índice de Massa Corporal (IMC) | Calculado |
| Percentual de gordura corporal | Numérico |
| Massa muscular | Numérico |
| Circunferências (cintura, quadril, peito, braço, coxa) | Numérico |

### 4.4 Selfie de Evidência de Presença

A fotografia do aluno capturada como comprovante de presença em sessão presencial é tratada como dado biométrico potencial e armazenada de forma segura com período de retenção definido (730 dias). Além de comprovar a presença, essa imagem pode excepcionalmente ser acessada por um administrador da Muvify durante a análise manual de um caso de disputa envolvendo falta de comparecimento (item 10.5.2 dos Termos de Uso) — vide item 3.5.

---

## 5. FINALIDADES E BASES LEGAIS DO TRATAMENTO

O Muvify trata dados pessoais com fundamento nas seguintes bases legais, conforme arts. 7º e 11 da LGPD:

### 5.1 Tabela de Finalidades × Bases Legais

| Finalidade | Dados Envolvidos | Base Legal (LGPD) |
|---|---|---|
| Criação e autenticação de conta | Nome, e-mail, senha, telefone, CPF | Art. 7º, V — Execução de contrato |
| Exibição do perfil público do profissional | Nome profissional, bio, foto, vídeo, avaliações, categorias | Art. 7º, V — Execução de contrato |
| Validação do registro CREF | Número CREF, documentos comprobatórios | Art. 7º, V — Execução de contrato + Art. 7º, II — Cumprimento de obrigação legal/regulatória (regulamentação profissional) |
| Processamento de pagamentos | CPF, dados de cartão (tokenizados), PIX, histórico de transações | Art. 7º, V — Execução de contrato |
| Gestão de conta bancária do profissional | Dados bancários criptografados, chave PIX | Art. 7º, V — Execução de contrato |
| Envio de notificações e comunicações | E-mail, token push, preferências de notificação | Art. 7º, V — Execução de contrato; Art. 7º, IX — Legítimo interesse (comunicações operacionais) |
| Personalização e segurança do treino | Anamnese completa, dados de saúde | Art. 11, I — **Consentimento específico e destacado do titular** |
| Comprovação de presença em sessões | Selfie de evidência, data/hora, câmera | Art. 7º, V — Execução de contrato |
| Avaliações biométricas de progresso | Peso, altura, IMC, medidas corporais | Art. 11, I — Consentimento; Art. 11, II, "f" — Tutela da saúde |
| Busca e filtro de profissionais por localização | Latitude/longitude do profissional; lat/lng do aluno em busca | Art. 7º, V — Execução de contrato; Art. 7º, IX — Legítimo interesse |
| Sistema de avaliações e reputação | Notas e comentários de reviews | Art. 7º, V — Execução de contrato |
| Sistema social (follow, feed, ranking) | Follows, seguidores, posts de evolução | Art. 7º, I — Consentimento; Art. 7º, IX — Legítimo interesse |
| Prevenção de fraude e segurança | Logs de tentativas de login, rate limiting | Art. 7º, IX — Legítimo interesse (segurança da plataforma) |
| Exportação de dados pessoais (portabilidade) | Todos os dados do titular | Art. 18, V — Direito do titular |
| Encerramento de conta e anonimização | Todos os dados do titular | Art. 18, VI — Direito de eliminação; Art. 16 — Término do tratamento |
| Defesa em processos judiciais ou administrativos | Dados de transações, logs, histórico | Art. 7º, VI — Exercício regular de direitos em processo judicial, administrativo ou arbitral |
| Cumprimento de obrigações legais | CPF, transações financeiras, logs de acesso | Art. 7º, II — Cumprimento de obrigação legal (LGPD, Marco Civil da Internet, Receita Federal) |
| Monitoramento de erros e estabilidade técnica | Logs de erro (Sentry), métricas (Prometheus) | Art. 7º, IX — Legítimo interesse (manutenção e segurança da plataforma) |

### 5.2 Sobre o Legítimo Interesse

Quando invocamos o legítimo interesse (art. 7º, IX da LGPD) como base legal, garantimos que:

1. O interesse em questão é legítimo e não compromete direitos e liberdades fundamentais do titular;
2. Realizamos o balanceamento ("balancing test") entre nossos interesses e os do titular;
3. O titular pode a qualquer tempo se opor ao tratamento fundamentado em legítimo interesse (art. 18, X da LGPD), e avaliaremos o pedido.

---

## 6. COMPARTILHAMENTO DE DADOS COM TERCEIROS

A Muvify não vende dados pessoais a terceiros. O compartilhamento ocorre apenas nas hipóteses a seguir, sempre com as garantias adequadas:

### 6.1 Entre Usuários da Plataforma

O Aplicativo permite o compartilhamento controlado de dados entre seus usuários conforme a natureza do serviço:

- **Aluno → Profissional:** Nome, foto de perfil, anamnese (somente ao profissional contratado e com o consentimento do aluno), avaliações biométricas, histórico de treinos, mensagens de chat.
- **Profissional → Aluno:** Nome profissional, foto, vídeo, biografia, localização (aproximada para fins de busca), categorias, avaliação média, histórico de sessões.

### 6.2 Prestadores de Serviços (Operadores)

Os seguintes prestadores de serviços atuam como **operadores de dados** sob instrução da Muvify, com acesso restrito ao mínimo necessário para execução de seus serviços:

| Prestador | País/Região | Finalidade | Dados Compartilhados |
|---|---|---|---|
| **Mercado Pago S.A.** | Brasil / Argentina | Processamento de pagamentos, emissão de PIX, tokenização de cartões, gestão de repasses | CPF, dados de cartão (tokenizados), valor das transações, identificadores de pagamento, conta do profissional (Connect) |
| **Expo (Expo Technology, Inc.)** | EUA | Entrega de notificações push iOS e Android | Token push, dados da notificação (título, corpo, tipo) |
| **Provedor de E-mail SMTP** | Configurável | Envio de e-mails transacionais e operacionais | Nome, endereço de e-mail, conteúdo do e-mail |
| **Cloudflare (R2 Object Storage)** | Rede global (Cloudflare) | Armazenamento de fotos e vídeos enviados pelos usuários (foto de perfil, vídeo de apresentação do profissional, documentos do CREF, fotos do feed de evolução, mídia de exercícios) | Arquivos de imagem/vídeo enviados pelo usuário |
| **Amazon Web Services (AWS S3)** | EUA (região configurável) | Armazenamento de backups criptografados do banco de dados | Backup completo da base de dados (criptografado com chave própria) |
| **Sentry (Functional Software, Inc.)** | EUA | Monitoramento de erros e estabilidade da aplicação | Dados de contexto de erro (sem dados de saúde ou financeiros identificáveis) |

### 6.3 Autoridades Públicas

Compartilhamos dados com autoridades governamentais, judiciais, fiscais ou regulatórias quando houver:

- Ordem judicial ou determinação legal vigente;
- Obrigação regulatória (ex.: Receita Federal, Banco Central, ANPD);
- Necessidade de prevenção e repressão a crimes ou fraudes;
- Exercício regular de direitos em processo judicial, administrativo ou arbitral (art. 7º, VI da LGPD).

Nesses casos, compartilhamos apenas os dados estritamente necessários e, sempre que legalmente permitido, notificamos o titular.

### 6.4 Sucessores Empresariais

Em caso de fusão, aquisição, reorganização societária ou transferência de ativos, os dados pessoais poderão ser transferidos ao sucessor, desde que este assuma as mesmas obrigações de proteção de dados estabelecidas nesta Política. O titular será informado previamente, na medida do possível.

---

## 7. TRANSFERÊNCIA INTERNACIONAL DE DADOS

Alguns de nossos prestadores (vide item 6.2) possuem infraestrutura fora do Brasil. Nesses casos, adotamos as seguintes salvaguardas:

- **Mercado Pago:** Sujeito à regulamentação do Banco Central do Brasil e às normas de proteção de dados do Mercosul. Possui Política de Privacidade própria publicada.
- **Expo:** Transferência para os EUA. Adotamos cláusulas contratuais de proteção (DPA — Data Processing Agreement) com obrigações equivalentes às da LGPD.
- **Cloudflare (R2):** Rede de armazenamento distribuída globalmente. A Cloudflare possui certificações SOC 2 e ISO 27001 e disponibiliza cláusulas contratuais de proteção de dados (DPA) equivalentes às exigências da LGPD.
- **AWS S3:** Transferência para os EUA. A AWS possui certificações SOC 2, ISO 27001 e adere a mecanismos de adequação reconhecidos internacionalmente. Os backups são criptografados com chave exclusiva antes de qualquer upload (criptografia end-to-end).
- **Sentry:** Transferência para os EUA. Adotamos DPA e filtramos dados sensíveis antes do envio ao Sentry.

Todas as transferências internacionais observam o art. 33 da LGPD, assegurando que o país de destino oferece grau de proteção adequado ou que medidas contratuais garantem proteção equivalente.

---

## 8. RETENÇÃO E DESCARTE DE DADOS

A Muvify mantém os dados pessoais apenas pelo tempo necessário para as finalidades declaradas ou para o cumprimento de obrigações legais. A seguir, a tabela de retenção vigente:

| Categoria de Dado | Prazo de Retenção | Ação ao Final |
|---|---|---|
| Sessões autenticadas e refresh tokens | 45 dias após expiração/revogação | Exclusão automática |
| Tokens de recuperação de senha | 30 dias após uso ou expiração | Exclusão automática |
| Tokens de verificação de e-mail | 30 dias após uso ou expiração | Exclusão automática |
| Dispositivos push inativos | 180 dias após último uso | Exclusão automática |
| Notificações in-app | 730 dias (2 anos) após criação | Exclusão automática |
| Fila de retry de push com falha | 90 dias | Exclusão automática |
| Selfies de evidência de presença | 730 dias (2 anos) após criação | Exclusão automática |
| Anamnese (dados de saúde) | 730 dias (2 anos) após última atualização | Anonimização do conteúdo |
| Avaliações biométricas | 730 dias (2 anos) após criação | Anonimização do conteúdo |
| Mensagens de chat | 730 dias (2 anos) após última interação | Anonimização do conteúdo |
| Comentários de reviews | 730 dias (2 anos) | Anonimização do conteúdo |
| Notas de agendamento | 730 dias (2 anos) | Anonimização do conteúdo |
| Fila de e-mail com falha | 90 dias | Exclusão automática |
| Registros de tickets de suporte | 5 anos (1.825 dias) | Anonimização do conteúdo |
| Motivo de relato/contestação de falta e nota de caso de disputa | 730 dias (2 anos) após a resolução do caso | Anonimização do conteúdo (o registro do caso — status, decisão, valores — é mantido para auditoria) |
| Registros financeiros e auditoria de pagamentos (inclui pacotes presenciais e seus ciclos de cobrança) | Mínimo 5 anos | Arquivamento seguro com acesso restrito |
| Logs de acesso à aplicação | Mínimo 6 meses (Marco Civil da Internet, art. 15) | Rotação/exclusão automatizada |

### 8.1 Encerramento de Conta (Exclusão a Pedido)

O titular pode solicitar a exclusão de sua conta a qualquer momento pelo Aplicativo (Configurações → Excluir minha conta), confirmando com sua senha. A exclusão executa as seguintes ações de forma atômica:

1. Revogação imediata de todas as sessões ativas e tokens de autenticação;
2. Desativação de todos os dispositivos push registrados;
3. Exclusão de preferências de notificação e histórico de notificações;
4. Exclusão de métodos de pagamento e zeragem de identificadores de cartão;
5. Exclusão de dados de anamnese;
6. Exclusão de selfies de evidência de presença;
7. Anonimização de mensagens de chat;
8. Exclusão de tickets de suporte (respeitado o prazo de 5 anos para defesa de direitos);
9. Para o Profissional: exclusão de conta bancária, CREF, localizações, disponibilidades, planos, dados financeiros e zeragem do perfil público ("Personal removido");
10. **Anonimização do usuário principal:** e-mail → `deleted_{id}@removed.invalid`, nome → "Usuário removido", telefone → nulo, foto → nula, senha → hash aleatório (login impossibilitado definitivamente).

**Dados retidos após exclusão:** Registros financeiros de transações passadas são mantidos pelo prazo legal mínimo de 5 anos para fins fiscais e de defesa de direitos, sem qualquer uso para finalidades de marketing ou análise.

### 8.2 Exceção Legal (Legal Hold)

Quando houver litígio, investigação, ordem judicial ou exigência regulatória envolvendo um titular, o descarte de seus dados é suspenso enquanto perdurar a causa, retomando o ciclo normal após o encerramento.

---

## 9. MEDIDAS DE SEGURANÇA

A Muvify adota medidas técnicas e organizacionais adequadas à proteção dos dados pessoais, em conformidade com o art. 46 da LGPD:

### 9.1 Medidas Técnicas

- **Criptografia de senhas:** Algoritmo bcrypt com 12 rounds de hashing — senhas nunca são armazenadas em texto claro;
- **Criptografia de dados sensíveis:** Dados bancários criptografados com AES-256 usando chave exclusiva de produção (`APP_ENCRYPTION_KEY`), obrigatória e distinta do JWT secret;
- **Criptografia em trânsito:** TLS 1.2+ obrigatório em todas as comunicações entre o Aplicativo e os servidores (HTTPS/WSS);
- **Criptografia em repouso:** Redis com TLS obrigatório em ambiente de produção (protocolo `rediss://`); backups criptografados com chave exclusiva antes do envio ao S3;
- **Controle de acesso:** Autenticação JWT com refresh tokens de curta duração; bloqueio automático após 10 tentativas de login fracassadas (15 minutos de bloqueio via Redis rate limiter);
- **Segurança do código de presença:** Rate limiting de 10 tentativas por 15 minutos para impedir força bruta;
- **Autenticação de dois fatores (2FA):** Disponível para usuários que optarem por habilitá-la;
- **Separação de ambientes:** Configurações distintas para desenvolvimento, teste e produção, com enforcement de chaves de produção;
- **Monitoramento de segurança:** Sentry para rastreamento de erros; Prometheus para métricas operacionais; logs de auditoria de pagamento persistentes;
- **Proteção de API:** CORS configurado, rate limiting, validação de entrada, sanitização contra injeção.

### 9.2 Medidas Organizacionais

- Acesso aos dados restrito a colaboradores com necessidade operacional ("need-to-know");
- Política interna de segurança da informação;
- Auditoria de execuções de expurgo de dados com logs persistentes;
- Legal Hold formalizado para titulares em litígio.

### 9.3 Limitações de Responsabilidade

Nenhum sistema é absolutamente inviolável. Em caso de incidente de segurança que resulte em acesso não autorizado a dados pessoais, adotaremos as medidas de contenção e notificação descritas no item 15.

---

## 10. DIREITOS DO TITULAR

Em conformidade com os arts. 17 a 22 da LGPD, o titular tem os seguintes direitos:

| Direito | Descrição | Como exercer no Muvify |
|---|---|---|
| **Confirmação de tratamento** | Saber se tratamos dados seus | Resposta em até 15 dias úteis via canal do DPO |
| **Acesso** | Obter cópia de todos os seus dados pessoais | No Aplicativo: Configurações → Exportar meus dados (JSON) |
| **Retificação** | Corrigir dados incompletos, inexatos ou desatualizados | No Aplicativo: Editar perfil; ou via DPO para campos não editáveis |
| **Anonimização, bloqueio ou eliminação** | Para dados desnecessários, excessivos ou tratados em desconformidade com a LGPD | Via DPO; ou exclusão total pelo Aplicativo |
| **Portabilidade** | Receber seus dados em formato estruturado e interoperável | No Aplicativo: Configurações → Exportar meus dados (formato JSON) |
| **Eliminação** | Solicitar eliminação de dados tratados com base em consentimento, ressalvadas as exceções legais | No Aplicativo: Configurações → Excluir minha conta; ou via DPO |
| **Informação sobre compartilhamento** | Saber com quais entidades compartilhamos seus dados | Esta Política (item 6); e via DPO para casos específicos |
| **Informação sobre recusa de consentimento** | Conhecer as consequências de não fornecer consentimento | Descrito em cada formulário de coleta |
| **Revogação do consentimento** | Revogar consentimento previamente concedido | Via DPO ou funcionalidade específica no Aplicativo |
| **Oposição ao tratamento** | Opor-se ao tratamento fundamentado em legítimo interesse | Via DPO — avaliaremos e responderemos |
| **Revisão de decisões automatizadas** | Solicitar revisão humana de decisões tomadas exclusivamente por algoritmos | Via DPO |
| **Reclamação à ANPD** | Peticionar perante a Autoridade Nacional de Proteção de Dados | Diretamente pelo portal da ANPD: gov.br/anpd |

### 10.1 Exercício dos Direitos

Para exercer qualquer direito listado acima, entre em contato com nosso Encarregado de Dados (DPO) pelo e-mail **[EMAIL DO DPO]** ou pelo canal de suporte indicado no Aplicativo. Responderemos em até **15 (quinze) dias úteis**, podendo esse prazo ser prorrogado uma vez, com justificativa fundamentada.

Para confirmar sua identidade antes de atender sua solicitação, poderemos solicitar documentos de identificação.

---

## 11. CONSENTIMENTO E REVOGAÇÃO

### 11.1 Como coletamos o consentimento

O consentimento para o tratamento de dados pessoais é coletado no momento do cadastro, exigindo:

- Indicação expressa da versão dos documentos aceitos (campo `termsVersion`);
- Marcação explícita de aceite (`consentAccepted: true`) — sem aceite, o cadastro é recusado;
- Registro do timestamp exato de aceite (`termsAcceptedAt`, `privacyPolicyAcceptedAt`) vinculado à versão dos documentos.

Para dados de saúde (anamnese), o consentimento é coletado em formulário específico, **separado e destacado**, antes do preenchimento da anamnese.

### 11.2 Versionamento

Mantemos registro da versão dos Termos e da Política aceita por cada usuário, permitindo demonstrar conformidade em auditorias regulatórias.

### 11.3 Consequências da não concessão ou da revogação do consentimento

| Consentimento | Consequência da recusa ou revogação |
|---|---|
| Cadastro geral (Termos + Política) | Impossibilidade de criar conta ou acessar o Aplicativo |
| Anamnese (dados de saúde) | O profissional não terá acesso ao histórico clínico; poderá haver limitação na personalização dos treinos |
| Notificações de marketing | As comunicações promocionais cessam; notificações operacionais continuam (ex.: confirmação de pagamento) |
| Autorização de uso de imagem | Imagens do aluno não poderão ser utilizadas para fins de divulgação ou marketing |

### 11.4 Revogação do consentimento

O titular pode revogar qualquer consentimento a qualquer momento, sem ônus, pelo canal do DPO ou pelas funcionalidades do Aplicativo (ex.: desativação de preferências de notificação). A revogação não afeta a licitude do tratamento realizado antes da revogação (art. 8º, § 5º da LGPD).

---

## 12. USO POR MENORES DE IDADE

O Aplicativo Muvify é destinado exclusivamente a **pessoas com 18 (dezoito) anos ou mais**.

Não coletamos intencionalmente dados pessoais de menores de 14 anos. Caso identificarmos que coletamos inadvertidamente dados de menor sem o consentimento válido do responsável legal, eliminaremos tais dados imediatamente (art. 14, §§ 3º e 4º da LGPD).

Se você tem ciência de que um menor forneceu dados ao Muvify sem autorização do responsável legal, contate nosso DPO imediatamente pelo e-mail **[EMAIL DO DPO]**.

**Adolescentes entre 14 e 17 anos:** Nos termos do art. 14, § 1º da LGPD, o tratamento de dados de adolescentes entre 14 e 17 anos somente é admitido mediante consentimento específico de pelo menos um dos responsáveis legais. Por ora, o Aplicativo não admite o cadastro de menores de 18 anos. Caso essa política venha a ser alterada, os mecanismos de coleta de consentimento parental serão implementados previamente.

---

## 13. DADOS DE GEOLOCALIZAÇÃO

### 13.1 Dados coletados e finalidade

| Quem | Dado | Finalidade | Obrigatoriedade |
|---|---|---|---|
| Profissional (PROVIDER) | Latitude e longitude do perfil; localizações fixas de atendimento (até 20 pontos); localizações excluídas | Exibição no mapa de busca; filtro de distância pelos alunos | Necessário para aparecer na busca |
| Aluno (CLIENT) | Latitude e longitude enviados no momento da busca de profissionais | Calcular distância até os profissionais disponíveis (algoritmo Haversine) | Opcional — sem localização, busca por distância não é exibida |

### 13.2 Retenção

- A geolocalização do Profissional é armazenada permanentemente no perfil e zerada (null) ao excluir a conta.
- A geolocalização do Aluno durante a busca **não é armazenada persistentemente** — é utilizada apenas para cálculo em tempo real.

### 13.3 Localização em segundo plano (Profissional, opcional)

O Profissional pode **ativar, de forma opcional**, o compartilhamento contínuo da sua localização — inclusive com o aplicativo em segundo plano — para manter sua posição atualizada no mapa de busca dos Alunos. Essa função:

- é **desativada por padrão** e só é ligada por ação explícita do Profissional, que pode desligá-la a qualquer momento;
- exige autorização específica do sistema operacional do aparelho para localização em segundo plano, solicitada no momento da ativação;
- exibe uma notificação persistente enquanto estiver ativa, informando que a localização está sendo compartilhada;
- é usada **exclusivamente** para atualizar a posição exibida aos Alunos na busca por distância (Cláusula 13.1) — não é compartilhada com terceiros nem usada para nenhuma outra finalidade.

A geolocalização do Aluno **nunca** é coletada em segundo plano — segue integralmente a Cláusula 13.1 (somente durante o uso ativo da busca). A retenção da localização do Profissional segue a Cláusula 13.2.

---

## 14. NOTIFICAÇÕES E COMUNICAÇÕES

### 14.1 Notificações Push

O Muvify utiliza o serviço Expo Push Notifications para enviar notificações ao dispositivo do usuário. O usuário pode gerenciar suas preferências de notificação diretamente no Aplicativo, desabilitando categorias específicas:

| Categoria | Exemplos |
|---|---|
| **BOOKINGS** | Confirmação de agendamento, cancelamento, lembrete 30/60 min antes da sessão |
| **PAYMENTS** | Autorização, captura e reembolso de pagamentos |
| **CONSULTANCY** | Novas requisições de consultoria, respostas do profissional |
| **SYSTEM** | Alterações críticas na conta, segurança |
| **MARKETING** | Promoções, novidades e atualizações do Aplicativo |

**Atenção:** A desabilitação das categorias BOOKINGS, PAYMENTS, CONSULTANCY e SYSTEM pode impactar a experiência de uso e a segurança da conta.

### 14.2 Comunicações por E-mail

Enviamos e-mails para as seguintes finalidades:

- Confirmação de cadastro e verificação de e-mail;
- Recuperação de senha;
- Alertas de segurança (alteração de senha, e-mail de recuperação);
- Notificações operacionais de agendamentos e pagamentos;
- Comunicações de suporte;
- Comunicações promocionais (somente com consentimento e com opção de descadastro em cada e-mail).

---

## 15. INCIDENTES DE SEGURANÇA

Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares (acesso não autorizado, vazamento, destruição ou alteração de dados pessoais), adotaremos as seguintes medidas:

1. **Contenção imediata:** Isolamento do vetor de ataque, bloqueio de acessos comprometidos, preservação de evidências;
2. **Avaliação de impacto:** Identificação dos dados e titulares afetados, natureza e extensão do incidente;
3. **Comunicação à ANPD:** Notificação no prazo previsto na Resolução CD/ANPD nº 15/2024, contendo as informações requeridas;
4. **Comunicação aos titulares afetados:** Notificação direta quando o incidente puder acarretar risco relevante, com orientações sobre medidas protetivas;
5. **Medidas corretivas:** Implementação de controles adicionais para evitar recorrência.

Mantemos plano de resposta a incidentes documentado e testado periodicamente.

---

## 16. ENCARREGADO DE PROTEÇÃO DE DADOS (DPO)

Em conformidade com o art. 41 da LGPD e a Resolução CD/ANPD nº 18/2024, a Muvify designa o seguinte Encarregado de Proteção de Dados:

**Nome:** [NOME DO ENCARREGADO]  
**E-mail:** [EMAIL DO DPO]  
**Endereço:** [ENDEREÇO PARA CORRESPONDÊNCIA]

O Encarregado é responsável por:

- Aceitar reclamações e comunicações dos titulares;
- Receber comunicações da ANPD;
- Orientar os colaboradores da Muvify sobre práticas de proteção de dados;
- Executar as demais atribuições determinadas pelo Controlador ou estabelecidas em normas complementares.

---

## 17. ALTERAÇÕES NESTA POLÍTICA

Esta Política pode ser atualizada a qualquer tempo, em razão de mudanças legais, regulatórias ou no produto.

Em caso de alterações relevantes, notificaremos os titulares:

- Com aviso na tela de abertura do Aplicativo, exigindo re-aceite da nova versão;
- Por e-mail cadastrado;
- Com antecedência mínima de **15 (quinze) dias** antes da entrada em vigor da nova versão, exceto nos casos em que a urgência regulatória exija prazo menor.

O histórico de versões da Política será mantido acessível no Aplicativo e no site oficial. A continuidade do uso do Aplicativo após a entrada em vigor da nova versão constitui aceite tácito das alterações não substanciais. Para alterações substanciais (ex.: novo uso de dados sensíveis, novo compartilhamento), exigiremos re-consentimento explícito.

---

## 18. LEGISLAÇÃO APLICÁVEL E FORO

Esta Política é regida pelas leis da República Federativa do Brasil, em especial:

- Lei nº 13.709/2018 (LGPD);
- Lei nº 12.965/2014 (Marco Civil da Internet);
- Lei nº 8.078/1990 (Código de Defesa do Consumidor);
- Resoluções e orientações da ANPD.

Para dirimir quaisquer controvérsias oriundas desta Política, fica eleito o foro da comarca de **[CIDADE/UF]**, com renúncia expressa a qualquer outro, por mais privilegiado que seja, salvo nos casos em que o consumidor optar pelo foro do seu domicílio.

---

*Muvify — Política de Privacidade v1.0*  
*[RAZÃO SOCIAL DA EMPRESA] — CNPJ [CNPJ]*  
*Vigência: a partir de [DATA DE PUBLICAÇÃO]*
