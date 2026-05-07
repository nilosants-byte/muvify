ALTER TABLE "Exercise"
ADD COLUMN IF NOT EXISTS "defaultRepetitionsSets" TEXT,
ADD COLUMN IF NOT EXISTS "defaultRestLabel" TEXT;
