# Rascunho — Justificativa de Localização em Segundo Plano (Google Play)

O Google Play exige, pra qualquer app que declare `ACCESS_BACKGROUND_LOCATION`, um formulário
dedicado no Play Console (Policy → App content → Background location) explicando o uso, **mais um
vídeo curto demonstrando o fluxo dentro do app**. Este documento é o rascunho do texto — o vídeo
precisa ser gravado à parte (roteiro na seção final).

## Onde o uso acontece no código
- `mobile-app/src/services/location/providerBackgroundLocation.ts` — `TaskManager.defineTask` +
  `Location.startLocationUpdatesAsync`, com foreground service e notificação persistente.
- Ativado pelo toggle em `mobile-app/src/screens/professional/components/ServiceAreaInlineSection.tsx`
  (`toggleBackgroundLocation`).
- Documentado em `docs/POLITICA-DE-PRIVACIDADE-v1.md`, cláusula 13.3.

## Texto pro formulário do Play Console

**Feature que usa localização em segundo plano:**
Compartilhamento contínuo e opcional da localização do profissional (personal trainer) no mapa de
busca dos alunos.

**Por que a feature precisa de localização em segundo plano (não dá pra usar só foreground):**
Personal trainers que atendem em domicílio/deslocamento se movem entre atendimentos ao longo do dia.
Se a localização só fosse capturada com o app aberto em primeiro plano, o profissional precisaria
manter o app ativo e a tela ligada o tempo todo pra que sua posição no mapa de busca dos alunos ficasse
atualizada — inviável na prática (o app fica em segundo plano assim que o profissional atende uma
ligação, troca de aplicativo pra usar GPS de navegação até o próximo atendimento, ou simplesmente
bloqueia a tela). Sem atualização em segundo plano, alunos veriam a localização do profissional
desatualizada (de horas atrás), tornando a busca por distância não confiável.

**Como o usuário ativa e controla:**
1. A feature é **desligada por padrão** — nunca ativada automaticamente.
2. O profissional ativa manualmente um toggle na tela "Área de atendimento" (Configurações → Área de
   atendimento).
3. O sistema operacional pede autorização específica de localização em segundo plano nesse momento
   (nunca antes, nunca sem essa ação explícita do usuário).
4. Enquanto ativa, uma **notificação persistente** fica visível o tempo todo, informando que a
   localização está sendo compartilhada — o usuário pode desligar a qualquer momento pelo mesmo toggle
   ou tocando na notificação.
5. Ao excluir a conta ou desativar o toggle, a coleta para imediatamente.

**O que é feito com o dado:**
A localização atualiza só a posição do profissional no mapa de busca — nunca é repassada a terceiros,
nunca usada pra publicidade, nunca vendida. Retida enquanto a conta existir (zerada ao excluir a
conta).

## Roteiro do vídeo de demonstração (30-60s, gravar na build de produção/preview)

1. (0-5s) Logar como profissional, ir em Configurações → Área de atendimento.
2. (5-15s) Mostrar o toggle "Compartilhar localização em segundo plano" desligado, tocar pra ligar.
3. (15-25s) Mostrar o prompt nativo do sistema pedindo autorização de localização "sempre"/segundo
   plano, conceder.
4. (25-35s) Mostrar a notificação persistente aparecendo na barra de notificações do sistema.
5. (35-50s) Minimizar o app (ir pra tela inicial do celular), esperar alguns segundos, reabrir e
   mostrar que o toggle continua ativo e a notificação continua visível.
6. (50-60s) Voltar em Configurações → Área de atendimento, desligar o toggle, mostrar a notificação
   sumindo.

_Rascunho gerado na Frente 17 (segunda camada, prontidão de lançamento), 2026-08-14._
