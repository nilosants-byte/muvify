-- =============================================================================
-- SCRIPT DE LIMPEZA DE VÍDEOS
-- =============================================================================
-- Objetivo: remover dados de vídeo do banco para recuperar performance.
-- Seguro: afeta APENAS colunas de vídeo. Fotos e outros dados NÃO são tocados.
--
-- Quando rodar:
--   Execute este script UMA VEZ no banco de produção após fazer deploy
--   da aplicação com ENABLE_VIDEO_UPLOAD = false.
--
-- Como rodar (exemplos):
--   psql $DATABASE_URL -f scripts/clear-videos.sql
--   ou via Docker:
--   docker exec -i <container_postgres> psql -U <user> -d <db> < scripts/clear-videos.sql
-- =============================================================================

BEGIN;

-- 1. Remove vídeos de apresentação dos perfis de personal trainer.
--    A coluna photoUrl NÃO é tocada.
UPDATE "ProviderProfile"
SET "presentationVideoUrl" = NULL
WHERE "presentationVideoUrl" IS NOT NULL;

-- 2. Remove mídia do tipo VIDEO nos exercícios da biblioteca.
--    Exercícios com imagem (IMAGE), GIF, ou link do YouTube ficam intactos.
UPDATE "Exercise"
SET
  "mediaUrl"  = NULL,
  "mediaType" = NULL
WHERE "mediaType" = 'VIDEO';

-- Confirmação de quantas linhas foram afetadas (opcional — útil para log).
-- Postgres não tem ROW_COUNT após UPDATE dentro de uma transação de script;
-- use o retorno do cliente (rows affected) para verificação.

COMMIT;

-- =============================================================================
-- PARA REVERTER (restaurar a partir do backup):
--   Não é possível desfazer esta operação sem backup.
--   Certifique-se de ter um backup recente antes de executar.
--   Veja scripts/db-backup.ts para gerar um backup manual.
-- =============================================================================
