-- Frente 2: dois novos mecanismos de contestacao (Fase de seguranca de
-- pagamentos) - entrega de consultoria de qualidade inadequada, e cobranca
-- forcada por confirmacao unica de sessao avulsa.

ALTER TYPE "DisputeCaseType" ADD VALUE 'DELIVERY_CONTESTED';
ALTER TYPE "DisputeCaseType" ADD VALUE 'AUTO_CAPTURE_CONTESTED';
