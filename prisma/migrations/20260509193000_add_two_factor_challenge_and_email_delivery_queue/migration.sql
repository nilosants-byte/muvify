CREATE TABLE "TwoFactorLoginChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challengeTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TwoFactorLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TwoFactorLoginChallenge_challengeTokenHash_key"
  ON "TwoFactorLoginChallenge" ("challengeTokenHash");

CREATE INDEX "TwoFactorLoginChallenge_userId_expiresAt_idx"
  ON "TwoFactorLoginChallenge" ("userId", "expiresAt");

CREATE INDEX "TwoFactorLoginChallenge_expiresAt_consumedAt_idx"
  ON "TwoFactorLoginChallenge" ("expiresAt", "consumedAt");

ALTER TABLE "TwoFactorLoginChallenge"
  ADD CONSTRAINT "TwoFactorLoginChallenge_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE "EmailDeliveryQueue" (
  "id" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailDeliveryQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailDeliveryQueue_nextRetryAt_failedAt_idx"
  ON "EmailDeliveryQueue" ("nextRetryAt", "failedAt");
