-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpReason" ADD VALUE 'STREAK_WEEK_MILESTONE_4';
ALTER TYPE "XpReason" ADD VALUE 'STREAK_WEEK_MILESTONE_8';
ALTER TYPE "XpReason" ADD VALUE 'STREAK_WEEK_MILESTONE_12';
ALTER TYPE "XpReason" ADD VALUE 'STREAK_WEEK_MILESTONE_26';
ALTER TYPE "XpReason" ADD VALUE 'STREAK_WEEK_MILESTONE_52';

