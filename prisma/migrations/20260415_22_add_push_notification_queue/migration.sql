-- Retry queue for failed push notification deliveries.
-- Entries are created when an Expo chunk fails and deleted after successful retry.
-- failedAt is set when max attempts (3) is reached -- no further processing.
CREATE TABLE "PushNotificationQueue" (
  "id"          TEXT        NOT NULL,
  "messages"    JSONB       NOT NULL,
  "attempts"    INTEGER     NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failedAt"    TIMESTAMP(3),
  "lastError"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushNotificationQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushNotificationQueue_nextRetryAt_failedAt_idx"
  ON "PushNotificationQueue" ("nextRetryAt", "failedAt");
