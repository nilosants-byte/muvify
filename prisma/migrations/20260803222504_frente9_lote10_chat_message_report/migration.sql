-- CreateTable
CREATE TABLE "BookingMessageReport" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingMessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultancyMessageReport" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultancyMessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingMessageReport_messageId_idx" ON "BookingMessageReport"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingMessageReport_messageId_reporterId_key" ON "BookingMessageReport"("messageId", "reporterId");

-- CreateIndex
CREATE INDEX "ConsultancyMessageReport_messageId_idx" ON "ConsultancyMessageReport"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultancyMessageReport_messageId_reporterId_key" ON "ConsultancyMessageReport"("messageId", "reporterId");

-- AddForeignKey
ALTER TABLE "BookingMessageReport" ADD CONSTRAINT "BookingMessageReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "BookingMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingMessageReport" ADD CONSTRAINT "BookingMessageReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyMessageReport" ADD CONSTRAINT "ConsultancyMessageReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConsultancyMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultancyMessageReport" ADD CONSTRAINT "ConsultancyMessageReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

