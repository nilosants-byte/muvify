import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();

const booleanFlag = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(10),
  APP_ENCRYPTION_KEY: z.string().optional(),
  JWT_EXPIRES_IN: z.string().optional(),
  ACCESS_TOKEN_EXPIRES_IN: z.string().optional(),
  REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().int().min(1).default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  PASSWORD_RESET_TOKEN_EXPIRES_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  PASSWORD_RESET_WEB_URL: z.string().url().optional(),
  PASSWORD_RESET_TOKEN_EXPOSE_IN_DEV: booleanFlag.default(false),
  EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS: z.coerce.number().int().min(1).max(168).default(72),
  EMAIL_VERIFICATION_WEB_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: booleanFlag.default(false),
  SUPPORT_EMAIL_RECIPIENT: z.string().email().optional(),
  SUPPORT_EMAIL_FROM_NAME: z.string().trim().min(2).max(80).optional(),
  ADMIN_ALLOWED_EMAILS: z.string().default(""),
  METRICS_TOKEN: z.string().optional(),
  SWAGGER_BASIC_AUTH_PASSWORD: z.string().optional(),
  TRUST_PROXY: z.string().default("1"),
  API_JSON_LIMIT: z.string().default("10mb"),
  PROVIDER_PROFILE_JSON_LIMIT: z.string().default("50mb"),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:8081,http://localhost:3000")
    .refine(
      (val) => {
        return val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .every((origin) => {
            try {
              new URL(origin);
              return true;
            } catch {
              return false;
            }
          });
      },
      { message: "CORS_ORIGIN deve ser uma lista de URLs válidas separadas por vírgula." }
    ),
  MP_ACCESS_TOKEN: z.string().min(1),
  MP_PUBLIC_KEY: z.string().min(1),
  MP_WEBHOOK_SECRET: z.string().optional(),
  MP_APP_ID: z.string().optional(),
  MP_CLIENT_SECRET: z.string().optional(),
  MP_CONNECT_RETURN_URL: z.string().url().optional(),
  MP_CONNECT_REFRESH_URL: z.string().url().optional(),
  PRE_AUTH_WINDOW_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  BOOKING_ATTENDANCE_CODE_RELEASE_MINUTES: z.coerce.number().int().min(1).max(120).default(10),
  BOOKING_ATTENDANCE_CODE_EXPIRY_HOURS: z.coerce.number().int().min(1).max(72).default(6),
  REQUIRE_ANAMNESIS_FOR_CONTRACTS: booleanFlag.default(true),
  AUTO_CAPTURE_CONFIRMATION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  CONSULTANCY_DELIVERY_DEADLINE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PAYMENT_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  RUN_PAYMENT_JOBS: booleanFlag.default(true),
  RUN_DATA_RETENTION_JOBS: booleanFlag.default(true),
  DATA_RETENTION_JOB_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(10080).default(1440),
  DATA_RETENTION_DRY_RUN: booleanFlag.default(true),
  ALLOW_DATA_RETENTION_DRY_RUN_IN_PRODUCTION: booleanFlag.default(false),
  DATA_RETENTION_LEGAL_HOLD_USER_IDS: z.string().default(""),
  PUSH_NOTIFICATIONS_ENABLED: booleanFlag.default(true),
  EXPO_PUSH_API_URL: z
    .string()
    .url()
    .default("https://exp.host/--/api/v2/push/send"),
  EXPO_PUSH_ACCESS_TOKEN: z.string().optional()
});
const parsed = envSchema.parse(process.env);
// Wildcard CORS is never permitted — origins must be explicit in all environments.
if (parsed.CORS_ORIGIN.trim() === "*") {
  throw new Error("CORS_ORIGIN nao pode ser '*'. Informe URLs explícitas separadas por vírgula.");
}
if (parsed.NODE_ENV === "production" && !parsed.METRICS_TOKEN) {
  throw new Error("METRICS_TOKEN e obrigatorio em producao.");
}
if (parsed.NODE_ENV === "production" && !parsed.APP_ENCRYPTION_KEY?.trim()) {
  throw new Error("APP_ENCRYPTION_KEY e obrigatoria em producao.");
}
if (parsed.NODE_ENV === "production") {
  const hasSmtpConfig =
    Boolean(parsed.SMTP_HOST?.trim()) &&
    Boolean(parsed.SMTP_PORT) &&
    Boolean(parsed.SMTP_USER?.trim()) &&
    Boolean(parsed.SMTP_PASS?.trim()) &&
    Boolean(parsed.SMTP_FROM?.trim());
  if (!hasSmtpConfig) {
    throw new Error(
      "SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM sao obrigatorios em producao."
    );
  }

  if (!parsed.MP_WEBHOOK_SECRET?.trim()) {
    throw new Error("MP_WEBHOOK_SECRET e obrigatoria em producao.");
  }

  if (parsed.MP_APP_ID?.trim() && !parsed.MP_CLIENT_SECRET?.trim()) {
    throw new Error("MP_CLIENT_SECRET e obrigatoria em producao quando MP_APP_ID estiver definida.");
  }
}
if (
  parsed.NODE_ENV === "production" &&
  parsed.RUN_DATA_RETENTION_JOBS &&
  parsed.DATA_RETENTION_DRY_RUN &&
  !parsed.ALLOW_DATA_RETENTION_DRY_RUN_IN_PRODUCTION
) {
  throw new Error(
    "[DATA_RETENTION] DATA_RETENTION_DRY_RUN=true em producao bloqueado por seguranca. " +
      "Defina DATA_RETENTION_DRY_RUN=false para expurgo real ou " +
      "ALLOW_DATA_RETENTION_DRY_RUN_IN_PRODUCTION=true para excecao temporaria controlada."
  );
}
const appBaseUrl = parsed.APP_BASE_URL.replace(/\/+$/, "");
const adminAllowedEmails = parsed.ADMIN_ALLOWED_EMAILS
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
export const env = {
  ...parsed,
  ADMIN_ALLOWED_EMAILS: adminAllowedEmails,
  ACCESS_TOKEN_EXPIRES_IN:
    parsed.ACCESS_TOKEN_EXPIRES_IN ?? parsed.JWT_EXPIRES_IN ?? "15m",
  PASSWORD_RESET_WEB_URL:
    parsed.PASSWORD_RESET_WEB_URL ?? `${appBaseUrl}/reset-password`,
  EMAIL_VERIFICATION_WEB_URL:
    parsed.EMAIL_VERIFICATION_WEB_URL ?? `${appBaseUrl}/auth/verify-email`,
  MP_CONNECT_RETURN_URL:
    parsed.MP_CONNECT_RETURN_URL ?? `${appBaseUrl}/mp/return`,
  MP_CONNECT_REFRESH_URL:
    parsed.MP_CONNECT_REFRESH_URL ?? `${appBaseUrl}/mp/refresh`
};
