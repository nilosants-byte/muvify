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
