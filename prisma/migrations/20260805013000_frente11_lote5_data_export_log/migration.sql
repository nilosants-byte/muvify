-- Épico de Frentes, Frente 11, Lote 5: exportação self-service de dados
-- pessoais não deixava trilha de auditoria.
CREATE TABLE "DataExportLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataExportLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataExportLog_userId_createdAt_idx" ON "DataExportLog"("userId", "createdAt");
