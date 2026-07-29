import "dotenv/config";

process.env.NODE_ENV = "test";

const normalizeDbUrl = (url?: string) =>
  url?.replace("@localhost:", "@127.0.0.1:");

// Segurança de testes:
// Nunca usar DATABASE_URL "normal" como fallback para evitar rodar migrações/testes
// acidentalmente em banco não dedicado de testes.
const SAFE_TEST_DB_FALLBACK = "postgresql://postgres:postgres@127.0.0.1:5432/personal_app_test";

process.env.DATABASE_URL =
  normalizeDbUrl(process.env.TEST_DATABASE_URL) ||
  SAFE_TEST_DB_FALLBACK;
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.JWT_SECRET = process.env.JWT_SECRET || "testsecret123";
process.env.ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS = process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || "30";
process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES =
  process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES || "30";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
process.env.MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "test_mp_webhook_secret";
// Fake R2 config so storage.service.ts's getR2Config() doesn't throw in tests —
// the actual network call is mocked out (see tests/uploads.test.ts) so these
// values never need to resolve to a real Cloudflare account.
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "test-access-key";
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "test-secret-key";
process.env.R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "test-bucket";
process.env.R2_ENDPOINT = process.env.R2_ENDPOINT || "https://fake-r2.test";
process.env.R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "https://fake-r2-public.test";
// Frente 2 (Segurança do código), Lote 4: precisa estar setada pra dar pra
// testar a regressão funcional do compare timing-safe do Basic Auth do
// Swagger (ver tests/frente2-lote4-upload-binding-and-swagger.test.ts).
process.env.SWAGGER_BASIC_AUTH_PASSWORD =
  process.env.SWAGGER_BASIC_AUTH_PASSWORD || "test-swagger-basic-auth-password";
