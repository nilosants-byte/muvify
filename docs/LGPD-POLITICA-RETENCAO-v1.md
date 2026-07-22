# Muvify - Politica de Retencao e Descarte de Dados (LGPD)

- Versao: `1.0.0`
- Vigencia inicial: `2026-05-03`
- Revisao obrigatoria: semestral (ou antes, se houver mudanca legal/regratoria)
- Dono do documento: Produto + Engenharia + Encarregado (DPO)

## 1. Objetivo
Estabelecer regras formais de retencao, anonimização, descarte e trilha de auditoria para dados pessoais tratados no ecossistema Muvify (apps iOS/Android, backend, suporte e operacoes).

## 2. Escopo
Esta politica cobre:

1. Dados de alunos, profissionais e administradores.
2. Dados de autenticacao, notificacoes, chat, anamnese, comprovacoes de sessao, suporte e logs tecnicos.
3. Processos automatizados de expurgo e processos manuais sob excecao (legal hold).

## 3. Diretrizes gerais

1. Minimizacao: coletar e manter somente o necessario para finalidade legitima.
2. Limitacao de armazenamento: nao manter dados por tempo indefinido.
3. Seguranca: aplicar controles tecnicos e organizacionais durante todo o ciclo de vida.
4. Prestacao de contas: registrar execucoes de expurgo e manter evidencias auditaveis.
5. Excecoes legais: reter quando houver obrigacao legal/regulatoria ou defesa de direitos.

## 4. Bases legais de referencia

1. LGPD (Lei 13.709/2018): arts. 6, 7, 11, 15, 16, 18, 37, 46, 48.
2. Marco Civil da Internet (Lei 12.965/2014): art. 15 (guarda de registros de acesso a aplicacoes por 6 meses).
3. CDC (Lei 8.078/1990): arts. 27 e 43 (prazo de 5 anos para temas de consumo especificos).
4. CTN (Lei 5.172/1966): art. 195 e correlatos de prescricao tributaria.
5. Normas ANPD vigentes, incluindo:
   - Resolucao CD/ANPD 15/2024 (incidentes de seguranca).
   - Resolucao CD/ANPD 18/2024 (atuacao do encarregado).

## 5. Matriz de retencao (v1)

| Categoria de dado | Exemplos | Base legal principal | Retencao padrao | Gatilho de contagem | Destino final |
|---|---|---|---|---|---|
| Sessao e autenticacao | refresh tokens, sessoes revogadas/expiradas | Execucao de contrato + seguranca | 45 dias | expiracao/revogacao | Exclusao automatica |
| Token de reset de senha | token hash e metadados | Seguranca + execucao de contrato | 30 dias | uso/expiracao | Exclusao automatica |
| Token de verificacao de email | token hash e metadados | Execucao de contrato | 30 dias | uso/expiracao | Exclusao automatica |
| Dispositivos push inativos | token push invalido/inativo | Legitimo interesse (seguranca operacional) | 180 dias | inativacao | Exclusao automatica |
| Notificacoes in-app | titulo/corpo/dados de notificacao | Execucao de contrato | 24 meses | criacao | Exclusao automatica |
| Fila de retry de push | mensagens com falha | Legitimo interesse (resiliencia) | 90 dias | criacao/falha | Exclusao automatica |
| Comprovacao de sessao | selfies/evidencias de conclusao | Execucao de contrato + defesa | 24 meses | criacao | Exclusao automatica |
| Anamnese (sensivel) | respostas de saude/limitacoes | Consentimento especifico + tutela da saude quando aplicavel | 24 meses | ultima atualizacao | Redacao/anonimizacao de conteudo |
| Chat de agendamento | mensagens aluno-profissional | Execucao de contrato + defesa | 24 meses | ultima interacao | Redacao de conteudo |
| Suporte | mensagem do ticket e resposta | Execucao de contrato + defesa de direitos | 5 anos | criacao do ticket | Redacao de conteudo |
| Relato de falta e caso de disputa | motivo do relato/contestacao, nota de contexto e motivo da decisao do admin | Execucao de contrato + defesa | 24 meses apos resolucao | resolucao do caso | Redacao de conteudo (registro do caso mantido) |
| Pagamentos e evidencias financeiras (inclui pacotes presenciais e ciclos de cobranca) | status de pagamento, auditoria, conciliacao | Obrigacao legal/regulatoria + defesa | 5 anos (minimo) | liquidacao/encerramento | Arquivo restrito + descarte seguro futuro |
| Logs de acesso a aplicacao | metadados de acesso | Obrigacao legal (Marco Civil) | 6 meses (minimo legal) | geracao do registro | Expurgo automatizado/rotacao |

## 6. Regras de excecao (Legal Hold)

1. Havendo disputa, investigacao, ordem judicial ou exigencia regulatoria, o descarte fica suspenso para os titulares envolvidos.
2. O bloqueio de descarte deve ser formalizado e rastreavel.
3. Encerrado o motivo do hold, a retencao volta ao ciclo normal.

## 7. Direitos do titular e impacto na retencao

1. Solicitacoes de eliminacao devem ser atendidas nos limites tecnicos e legais.
2. Se houver base para conservacao (ex.: obrigacao legal/defesa), aplica-se bloqueio de uso para novas finalidades.
3. Sempre que possivel, preferir anonimizar em vez de manter dado pessoal identificavel.

## 8. Governanca e responsabilidades (RACI simplificado)

1. Controlador: Muvify (decisao sobre finalidades e meios).
2. Engenharia: implementa expurgo, trilhas e controles tecnicos.
3. Produto/Operacoes: garante coerencia de regra de negocio com prazos.
4. Encarregado (DPO): orienta conformidade, direitos dos titulares e interface com ANPD.
5. Juridico: valida excecoes, textos de termo/politica e riscos legais.

## 9. Auditoria e evidencia minima

1. Toda execucao automatica/manual de expurgo deve gerar log persistido.
2. O log deve registrar: horario, modo (`dry-run`/`apply`), regras executadas e volume afetado.
3. Evidencias devem ficar acessiveis para auditoria interna e eventual fiscalizacao.

## 10. Revisao e melhoria continua

1. Esta versao e o baseline minimo aceitavel para producao segura.
2. A politica deve evoluir com:
   - novos fluxos de produto;
   - novas exigencias legais/regulatorias;
   - resultados de auditoria e incidentes.
