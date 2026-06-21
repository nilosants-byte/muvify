/*
  Warnings:

  - A unique constraint covering the columns `[providerId,name]` on the table `FinancialStudent` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,reason,referenceId]` on the table `UserXpTransaction` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "BookingMessage" DROP CONSTRAINT "BookingMessage_senderId_fkey";

-- DropForeignKey
ALTER TABLE "UserAchievement" DROP CONSTRAINT "UserAchievement_achievementId_fkey";

-- AlterTable
ALTER TABLE "EmailDeliveryQueue" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "apelido" DROP NOT NULL,
ALTER COLUMN "apelido" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "BookingMessage_senderId_createdAt_idx" ON "BookingMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientAnamnesis_clientId_updatedAt_idx" ON "ClientAnamnesis"("clientId", "updatedAt");

-- CreateIndex
CREATE INDEX "ConsultancyContract_clientId_paymentStatus_status_idx" ON "ConsultancyContract"("clientId", "paymentStatus", "status");

-- CreateIndex
CREATE INDEX "EmailDeliveryQueue_createdAt_idx" ON "EmailDeliveryQueue"("createdAt");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Exercise_category_name_idx" ON "Exercise"("category", "name");

-- CreateIndex
CREATE INDEX "FeedPost_userId_isAutomatic_createdAt_idx" ON "FeedPost"("userId", "isAutomatic", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPostComment_userId_createdAt_idx" ON "FeedPostComment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPostLike_userId_createdAt_idx" ON "FeedPostLike"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialStudent_providerId_name_key" ON "FinancialStudent"("providerId", "name");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PaymentAuditLog_createdAt_idx" ON "PaymentAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PushNotificationQueue_failedAt_nextRetryAt_attempts_idx" ON "PushNotificationQueue"("failedAt", "nextRetryAt", "attempts");

-- CreateIndex
CREATE INDEX "RankingSnapshot_periodType_periodKey_xpEarned_userId_idx" ON "RankingSnapshot"("periodType", "periodKey", "xpEarned", "userId");

-- CreateIndex
CREATE INDEX "Review_userId_createdAt_idx" ON "Review"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_expiresAt_idx" ON "Session"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserXpTransaction_userId_reason_referenceId_key" ON "UserXpTransaction"("userId", "reason", "referenceId");

-- AddForeignKey
ALTER TABLE "BookingMessage" ADD CONSTRAINT "BookingMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
