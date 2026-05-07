-- CreateTable
CREATE TABLE "ProviderStudentAssessment" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weight" TEXT,
    "height" TEXT,
    "imc" TEXT,
    "bodyFatPercent" TEXT,
    "muscleMass" TEXT,
    "circumferences" TEXT,
    "waist" TEXT,
    "hip" TEXT,
    "chest" TEXT,
    "arm" TEXT,
    "thigh" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderStudentAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderStudentAssessment_providerId_clientId_key" ON "ProviderStudentAssessment"("providerId", "clientId");

-- CreateIndex
CREATE INDEX "ProviderStudentAssessment_clientId_updatedAt_idx" ON "ProviderStudentAssessment"("clientId", "updatedAt");

-- CreateIndex
CREATE INDEX "ProviderStudentAssessment_providerId_updatedAt_idx" ON "ProviderStudentAssessment"("providerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ProviderStudentAssessment" ADD CONSTRAINT "ProviderStudentAssessment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderStudentAssessment" ADD CONSTRAINT "ProviderStudentAssessment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
