-- Épico de Frentes, Frente 11, Lote 3: ClientAnamnesis.answers passa de
-- jsonb pra text, pra guardar o payload cifrado (encryptJson) em vez do
-- JSON em texto claro. USING preserva o conteúdo existente como texto (a
-- cifragem dos dados já existentes é feita depois, por script de
-- migração, não por esta migration).
ALTER TABLE "ClientAnamnesis" ALTER COLUMN "answers" SET DATA TYPE TEXT USING "answers"::TEXT;
