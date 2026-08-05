-- Épico de Frentes, Frente 11, Lote 3: trilha de acesso de profissional a
-- dado de saúde do aluno (anamnese) - inexistente até aqui.
CREATE TABLE "HealthDataAccessLog" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthDataAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HealthDataAccessLog_clientId_createdAt_idx" ON "HealthDataAccessLog"("clientId", "createdAt");

CREATE INDEX "HealthDataAccessLog_providerId_createdAt_idx" ON "HealthDataAccessLog"("providerId", "createdAt");
