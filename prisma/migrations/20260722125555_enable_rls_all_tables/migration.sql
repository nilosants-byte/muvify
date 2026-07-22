-- Ativa Row Level Security em todas as tabelas do schema (sem policies = nega tudo
-- pra qualquer role que nao seja superusuario). O backend conecta como `postgres`
-- (superusuario, ignora RLS), entao isso nao muda nenhum comportamento da API --
-- so fecha a brecha teorica de acesso direto ao banco fora do backend, apontada
-- pelo Supabase Advisor.

ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AdminAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ServiceCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."NoShowReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DisputeCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Favorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TwoFactorLoginChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TwoFactorBackupCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EmailVerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CustomerPaymentMethod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CompletionEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PushDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."SupportTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PushNotificationQueue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EmailDeliveryQueue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderBankAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."OnlineConsultancySetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderServiceOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PresentialPackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PresentialPackageCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TrainingPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TrainingPlanExercise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Exercise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ConsultancyRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ConsultancyContract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderCalendarEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ClientAnamnesis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderStudentAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FinancialStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FinancialIncome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FinancialExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FinancialGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FinancialClassSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderManualBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TrainingPlanCompletion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."BookingMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DataRetentionExecutionLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PaymentAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserXpTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserStreak" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Achievement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserAchievement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Follow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FeedPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FeedPostLike" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FeedPostComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RankingSnapshot" ENABLE ROW LEVEL SECURITY;
