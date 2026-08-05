-- AlterTable
ALTER TABLE "UserStreak" ADD COLUMN     "currentStreakWeeks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "daysTrainedThisWeek" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "longestStreakWeeks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalDaysTrained" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weekKey" TEXT;

-- Corte de modelo: streak antiga (por dia corrido) não é comparável com a
-- nova (por semana batendo a meta pessoal) - decisão do usuário (05/08/2026)
-- foi resetar a sequência atual no corte, mantendo o recorde (longestStreak)
-- como lembrança histórica. App ainda não lançado, sem usuário real afetado.
UPDATE "UserStreak" SET "currentStreak" = 0, "weekKey" = NULL, "daysTrainedThisWeek" = 0, "currentStreakWeeks" = 0;

