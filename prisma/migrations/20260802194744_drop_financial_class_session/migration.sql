-- Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 6:
-- FinancialClassSession nunca teve nenhuma tela do app criando um registro
-- (zero call sites de createSession) - a meta de "aulas por semana" era
-- sempre 0%, pra todo profissional. A métrica passa a contar sessões reais
-- já rastreadas pelo app (bookings concluídos + entregas de consultoria).
DROP TABLE "FinancialClassSession";
