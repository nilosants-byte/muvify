-- RLS não é herdado: estas tabelas nasceram depois de 20260722125555_enable_rls_all_tables.
ALTER TABLE "public"."BookingMessageReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ConsultancyMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ConsultancyMessageReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CrefDocumentUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DataExportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DebtRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ExternalStudentInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FeedPostReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."HealthDataAccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ProviderSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."WaitlistSignup" ENABLE ROW LEVEL SECURITY;
-- IF EXISTS: não existe no shadow database.
ALTER TABLE IF EXISTS "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- anon/authenticated só existem no Supabase; RLS sozinho não cobre TRUNCATE.
DO $$
DECLARE
  papel text;
  obj record;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel);
    -- Só objetos deste role: REVOKE em objeto de outro dono falha e derruba o deploy.
    FOR obj IN
      SELECT c.oid::regclass AS nome,
             CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS tipo
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND pg_get_userbyid(c.relowner) = current_user
    LOOP
      EXECUTE format('REVOKE ALL ON %s %s FROM %I', obj.tipo, obj.nome, papel);
    END LOOP;
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', papel);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', papel);
  END LOOP;
END
$$;
