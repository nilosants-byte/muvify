-- Adiciona o valor SERVICE_PURCHASED ao enum XpReason
-- Usado quando um agendamento ou consultoria é pré-autorizado/contratado
ALTER TYPE "XpReason" ADD VALUE IF NOT EXISTS 'SERVICE_PURCHASED';
