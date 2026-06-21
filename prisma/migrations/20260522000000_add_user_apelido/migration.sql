-- Adiciona o campo @apelido ao modelo User.
-- O campo é nullable inicialmente para compatibilidade com usuários existentes.
-- Um slug único é gerado para cada usuário via PL/pgSQL antes de adicionar a constraint.

-- 1. Adicionar coluna como nullable
ALTER TABLE "User" ADD COLUMN "apelido" VARCHAR(30);

-- 2. Popular apelidos dos usuários existentes
--    Slug = name em minúsculas, chars não-[a-z0-9] viram _, + prefixo 6 chars do id
DO $$
DECLARE
  rec RECORD;
  base_slug TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR rec IN SELECT id, name FROM "User" WHERE apelido IS NULL LOOP
    -- Limpa o nome: lowercase + substitui não-alfanumérico por _
    base_slug := lower(regexp_replace(rec.name, '[^a-z0-9]+', '_', 'g'));
    -- Remove underscores do início e fim
    base_slug := trim('_' FROM base_slug);
    -- Limita a 23 chars para caber o sufixo do id (6 chars + _)
    base_slug := left(base_slug, 23);
    -- Se ficou vazio (nome com caracteres especiais), usa 'user'
    IF base_slug = '' THEN base_slug := 'user'; END IF;
    -- Adiciona prefixo do id (primeiros 6 chars em minúsculas)
    candidate := base_slug || '_' || left(lower(replace(rec.id, '-', '')), 6);
    -- Garante unicidade com sufixo numérico se necessário
    suffix := 0;
    WHILE EXISTS (SELECT 1 FROM "User" WHERE apelido = candidate AND id != rec.id) LOOP
      suffix := suffix + 1;
      candidate := base_slug || '_' || left(lower(replace(rec.id, '-', '')), 6) || suffix::TEXT;
    END LOOP;
    UPDATE "User" SET apelido = candidate WHERE id = rec.id;
  END LOOP;
END;
$$;

-- 3. Tornar o campo obrigatório e único
ALTER TABLE "User" ALTER COLUMN "apelido" SET NOT NULL;
CREATE UNIQUE INDEX "User_apelido_key" ON "User"("apelido");
