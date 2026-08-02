-- Épico de Frentes, Frente 7, Lote 2: PresentialPackageCycle/TrainingPlan
-- não tinham nenhum campo pra registrar que uma disputa vinculada foi
-- resolvida com reembolso - a receita continuava contada pra sempre nos
-- relatórios financeiros mesmo depois do dinheiro voltar pro cliente.
ALTER TABLE "PresentialPackageCycle" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "PresentialPackageCycle" ADD COLUMN "refundedAmountCents" INTEGER;

ALTER TABLE "TrainingPlan" ADD COLUMN "refundedAt" TIMESTAMP(3);
