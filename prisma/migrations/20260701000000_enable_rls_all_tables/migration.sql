-- Habilita Row Level Security em todas as tabelas.
--
-- O app nunca acessa o Supabase via API direta (PostgREST) — todo o tráfego
-- passa pelo backend Node/Prisma via conexão direta, que usa a role de serviço
-- e ignora RLS por design. Portanto, ativar RLS sem adicionar policies bloqueia
-- qualquer acesso externo via URL pública do Supabase sem afetar o app em nada.

ALTER TABLE "User"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderProfile"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceCategory"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderCategory"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Availability"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Favorite"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TwoFactorLoginChallenge"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TwoFactorBackupCode"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailVerificationToken"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPaymentMethod"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompletionEvidence"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushDevice"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserNotification"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicket"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushNotificationQueue"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailDeliveryQueue"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderBankAccount"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlineConsultancySetting"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderServiceOffer"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingPlan"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingPlanExercise"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exercise"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultancyRequest"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultancyContract"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderCalendarEvent"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientAnamnesis"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderStudentAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialStudent"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialIncome"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialExpense"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialGoal"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialClassSession"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderManualBlock"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingPlanCompletion"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingMessage"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataRetentionExecutionLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAuditLog"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserXpTransaction"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserStreak"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Achievement"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserAchievement"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Follow"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedPost"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedPostLike"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedPostComment"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RankingSnapshot"           ENABLE ROW LEVEL SECURITY;
