-- CreateEnum
CREATE TYPE "XpReason" AS ENUM (
  'PRESENTIAL_WORKOUT_COMPLETED',
  'ONLINE_WORKOUT_COMPLETED',
  'TRAINING_PLAN_COMPLETED',
  'POST_WORKOUT_PHOTO',
  'REVIEW_SUBMITTED',
  'NEW_PROVIDER_FIRST_SESSION',
  'ACHIEVEMENT_UNLOCKED',
  'LEVEL_UP',
  'WEEKLY_RANKING_1ST',
  'WEEKLY_RANKING_2ND',
  'WEEKLY_RANKING_3RD',
  'MONTHLY_RANKING_1ST',
  'MONTHLY_RANKING_2ND',
  'MONTHLY_RANKING_3RD',
  'GENERAL_RANKING_1ST_REACHED',
  'GENERAL_RANKING_2ND_REACHED',
  'GENERAL_RANKING_3RD_REACHED'
);

-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('CONSISTENCY', 'VOLUME', 'SOCIAL', 'RANKING', 'PROGRESSION');

-- CreateEnum
CREATE TYPE "MedalType" AS ENUM ('SPECIAL', 'BRONZE', 'SILVER', 'GOLD', 'DIAMOND');

-- CreateEnum
CREATE TYPE "AchievementConditionType" AS ENUM (
  'STREAK_SESSIONS',
  'TOTAL_WORKOUTS',
  'TOTAL_FOLLOWING',
  'TOTAL_FOLLOWERS',
  'WEEKLY_TOP3_REACHED',
  'WEEKLY_1ST_REACHED',
  'WEEKLY_TOP3_CONSECUTIVE_WEEKS',
  'TOTAL_REVIEWS_SUBMITTED',
  'TOTAL_PHOTO_POSTS',
  'DISTINCT_PROVIDERS_TRAINED',
  'LEVEL_REACHED'
);

-- CreateEnum
CREATE TYPE "FeedPostType" AS ENUM (
  'WORKOUT_COMPLETED',
  'ACHIEVEMENT_UNLOCKED',
  'LEVEL_UP',
  'STREAK_MILESTONE',
  'RANKING_POSITION_CLIMBED',
  'RANKING_ENTERED_WEEKLY_TOP3',
  'RANKING_WEEK_ENDED_TOP3',
  'RANKING_MONTH_ENDED_TOP3',
  'RANKING_ENTERED_MONTHLY_TOP5',
  'RANKING_ENTERED_GENERAL_TOP5',
  'MANUAL_PHOTO'
);

-- CreateEnum
CREATE TYPE "RankingPeriodType" AS ENUM ('WEEKLY', 'MONTHLY', 'ALLTIME');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "trainingDaysPerWeek" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "UserXpTransaction" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "amount"      INTEGER NOT NULL,
  "reason"      "XpReason" NOT NULL,
  "referenceId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserXpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStreak" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "currentStreak"       INTEGER NOT NULL DEFAULT 0,
  "longestStreak"       INTEGER NOT NULL DEFAULT 0,
  "lastTrainingDate"    TIMESTAMP(3),
  "trainingDaysPerWeek" INTEGER NOT NULL DEFAULT 3,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserStreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
  "id"             TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "category"       "AchievementCategory" NOT NULL,
  "medalType"      "MedalType" NOT NULL,
  "xpReward"       INTEGER NOT NULL,
  "conditionType"  "AchievementConditionType" NOT NULL,
  "conditionValue" INTEGER NOT NULL,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "achievementId" TEXT NOT NULL,
  "unlockedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
  "id"          TEXT NOT NULL,
  "followerId"  TEXT NOT NULL,
  "followingId" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPost" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "type"        "FeedPostType" NOT NULL,
  "referenceId" TEXT,
  "imageUrl"    TEXT,
  "caption"     TEXT,
  "metadata"    JSONB,
  "isAutomatic" BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPostLike" (
  "id"        TEXT NOT NULL,
  "postId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedPostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPostComment" (
  "id"        TEXT NOT NULL,
  "postId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedPostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "periodType"        "RankingPeriodType" NOT NULL,
  "periodKey"         TEXT NOT NULL,
  "xpEarned"          INTEGER NOT NULL DEFAULT 0,
  "lastKnownPosition" INTEGER,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserXpTransaction_userId_createdAt_idx" ON "UserXpTransaction"("userId", "createdAt");
CREATE INDEX "UserXpTransaction_createdAt_idx" ON "UserXpTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserStreak_userId_key" ON "UserStreak"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");
CREATE INDEX "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement"("userId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE INDEX "FeedPost_userId_createdAt_idx" ON "FeedPost"("userId", "createdAt");
CREATE INDEX "FeedPost_createdAt_idx" ON "FeedPost"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostLike_postId_userId_key" ON "FeedPostLike"("postId", "userId");
CREATE INDEX "FeedPostLike_postId_idx" ON "FeedPostLike"("postId");

-- CreateIndex
CREATE INDEX "FeedPostComment_postId_createdAt_idx" ON "FeedPostComment"("postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSnapshot_userId_periodType_periodKey_key" ON "RankingSnapshot"("userId", "periodType", "periodKey");
CREATE INDEX "RankingSnapshot_periodType_periodKey_xpEarned_idx" ON "RankingSnapshot"("periodType", "periodKey", "xpEarned");

-- AddForeignKey
ALTER TABLE "UserXpTransaction" ADD CONSTRAINT "UserXpTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStreak" ADD CONSTRAINT "UserStreak_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey"
  FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey"
  FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey"
  FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostLike" ADD CONSTRAINT "FeedPostLike_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedPostLike" ADD CONSTRAINT "FeedPostLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostComment" ADD CONSTRAINT "FeedPostComment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedPostComment" ADD CONSTRAINT "FeedPostComment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
