-- CreateEnum
CREATE TYPE "WaitlistAudience" AS ENUM ('CLIENT', 'PROFESSIONAL');

-- CreateTable
CREATE TABLE "WaitlistSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "audience" "WaitlistAudience" NOT NULL,
    "whatsapp" TEXT,
    "city" TEXT,
    "utmSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistSignup_email_key" ON "WaitlistSignup"("email");

-- CreateIndex
CREATE INDEX "WaitlistSignup_createdAt_idx" ON "WaitlistSignup"("createdAt");

-- CreateIndex
CREATE INDEX "WaitlistSignup_audience_idx" ON "WaitlistSignup"("audience");
