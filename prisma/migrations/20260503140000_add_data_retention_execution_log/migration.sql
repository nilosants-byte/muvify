-- CreateTable
CREATE TABLE "DataRetentionExecutionLog" (
    "id" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataRetentionExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataRetentionExecutionLog_createdAt_idx" ON "DataRetentionExecutionLog"("createdAt");

-- CreateIndex
CREATE INDEX "DataRetentionExecutionLog_status_createdAt_idx" ON "DataRetentionExecutionLog"("status", "createdAt");
