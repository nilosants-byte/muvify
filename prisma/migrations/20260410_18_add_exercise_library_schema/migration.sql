DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ExerciseMediaType' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "ExerciseMediaType" AS ENUM ('YOUTUBE', 'VIDEO', 'IMAGE', 'GIF');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Exercise" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "mediaUrl" TEXT,
  "mediaType" "ExerciseMediaType",
  "isPrebuilt" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TrainingPlanExercise"
ADD COLUMN IF NOT EXISTS "exerciseId" TEXT;

CREATE INDEX IF NOT EXISTS "Exercise_providerId_category_idx"
ON "Exercise"("providerId", "category");

CREATE INDEX IF NOT EXISTS "Exercise_isPrebuilt_category_idx"
ON "Exercise"("isPrebuilt", "category");

DO $$
BEGIN
  ALTER TABLE "TrainingPlanExercise"
  ADD CONSTRAINT "TrainingPlanExercise_exerciseId_fkey"
  FOREIGN KEY ("exerciseId")
  REFERENCES "Exercise"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Exercise"
  ADD CONSTRAINT "Exercise_providerId_fkey"
  FOREIGN KEY ("providerId")
  REFERENCES "ProviderProfile"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
