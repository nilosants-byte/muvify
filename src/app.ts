import "express-async-errors";
import compression from "compression";
import cors from "cors";
import { randomUUID, timingSafeEqual } from "crypto";
import * as Sentry from "@sentry/node";
import express from "express";
import fs from "fs";
import helmet from "helmet";
import path from "path";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { swaggerSpec } from "./docs/swagger";
import { errorMiddleware } from "./middlewares/error.middleware";
import { apiRateLimiter } from "./middlewares/rate-limit.middleware";
import { attachSentryErrorHandler } from "./config/sentry";
import { mpConnectRoutes } from "./modules/payments/routes/mercadopago-connect.routes";
import { metricsHandler, metricsMiddleware } from "./observability/metrics";
import { router } from "./routes";

function resolveTrustProxy(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "on") {
    return 1;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }
  return value;
}

export const app = express();
app.set("trust proxy", resolveTrustProxy(env.TRUST_PROXY));
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'"],
      // Frente 2 (Segurança do código), Lote 4: hoje nada serve <script> (o
      // build web do Expo, se presente em public/app, não é servido em
      // producao ainda) — 'self' em vez de 'none' é preventivo, pra não
      // quebrar silenciosamente o dia que esse build for integrado.
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(compression());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean)
  })
);
// Provider profile may include base64 video payloads. Keep this limit scoped to the
// specific route so the rest of the API remains on a stricter payload budget.
app.use(
  "/api/providers/profile",
  express.json({ limit: env.PROVIDER_PROFILE_JSON_LIMIT }),
  express.urlencoded({ extended: true, limit: env.PROVIDER_PROFILE_JSON_LIMIT })
);
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: env.API_JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: env.API_JSON_LIMIT }));
app.use(
  pinoHttp({
    genReqId: (request, response) => {
      const id = (request.headers["x-request-id"] as string) || randomUUID();
      response.setHeader("x-request-id", id);
      return id;
    },
    // Redact sensitive fields so PII never appears in log files.
    // Frente 13 (segunda camada), Lote 9: "req.body.*" abaixo é uma lista
    // extensa (achado M5 da investigação de observabilidade) mas hoje é
    // configuração INERTE — o serializer padrão do pino-http só loga
    // {id, method, url, query, params, headers, remoteAddress, remotePort}
    // do request (confirmado em node_modules/pino-std-serializers), nunca
    // "body", a menos que um `serializers`/`customProps` customizado seja
    // passado ao pinoHttp(...), o que este projeto não faz. Não é um
    // vazamento ativo, mas também não é uma proteção ativa hoje — se no
    // futuro alguém adicionar log de corpo de requisição (cenário
    // plausível durante um incidente), NÃO presuma que essa lista já
    // cobre isso; ela precisa ser conectada a um serializer de verdade
    // primeiro. Mantida (não removida) porque documenta a intenção e já
    // cobre os campos certos se/quando isso acontecer - só não ativa
    // sozinha.
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.newPassword",
        "req.body.currentPassword",
        "req.body.email",
        "req.body.recoveryEmail",
        "req.body.phone",
        "req.body.cpf",
        "req.body.document",
        "req.body.holderDocument",
        "req.body.accountNumber",
        "req.body.accountDigit",
        "req.body.agency",
        "req.body.pixKey",
        // Épico de Frentes, Frente 11, Lote 4: dado de saúde (respostas de
        // anamnese) e conteúdo de mensagem/chat/localização não estavam
        // cobertos - vazavam em texto pleno pro arquivo de log a cada
        // requisição logada.
        "req.body.answers",
        "req.body.content",
        "req.body.message",
        "req.body.caption",
        "req.body.latitude",
        "req.body.longitude",
        "req.query.email",
        "req.query.token"
      ],
      censor: "[REDACTED]"
    },
    transport:
      env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: { colorize: true }
          }
  })
);
// Frente 13 (segunda camada), Lote 2: sem isso, um evento no painel do
// Sentry não tinha como ser cruzado com a linha de log correspondente nem
// com o requestId que o cliente (app mobile, suporte) já recebe no corpo
// de toda resposta de erro (ver error.middleware.ts). Roda pra toda
// requisição (autenticada ou não), não só as que passam por
// ensureAuthenticated.
app.use((request, _response, next) => {
  const requestId = (request as unknown as { id?: string }).id;
  if (requestId) {
    Sentry.setTag("request_id", requestId);
  }
  next();
});
app.use(metricsMiddleware);
app.get("/health", async (_request, response) => {
  const checks: Record<string, "ok" | "error"> = {};
  const requiredChecks = {
    database: true,
    redis: env.AUTH_REQUIRE_REDIS_FOR_BLACKLIST
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  try {
    if (redis.status === "ready") {
      await redis.ping();
      checks.redis = "ok";
    } else {
      checks.redis = "error";
    }
  } catch {
    checks.redis = "error";
  }

  const readinessOk =
    checks.database === "ok" &&
    (!requiredChecks.redis || checks.redis === "ok");
  const degraded = Object.values(checks).some((value) => value === "error");

  const body =
    env.NODE_ENV === "production"
      ? { status: readinessOk ? "ok" : "degraded" }
      : {
          status: degraded ? "degraded" : "ok",
          readiness: readinessOk ? "ready" : "not_ready",
          requiredChecks,
          checks,
        };
  return response.status(readinessOk ? 200 : 503).json(body);
});
app.get("/metrics", metricsHandler);
app.use(mpConnectRoutes);
app.use(apiRateLimiter);
if (env.NODE_ENV !== "production") {
  const swaggerPassword = env.SWAGGER_BASIC_AUTH_PASSWORD;
  if (swaggerPassword) {
    app.use("/api/docs", (req, res, next) => {
      const auth = req.headers.authorization;
      if (auth && auth.startsWith("Basic ")) {
        const credentials = Buffer.from(auth.slice(6), "base64").toString("utf8");
        const [, password] = credentials.split(":");
        const passwordBuffer = Buffer.from(password ?? "", "utf8");
        const expectedBuffer = Buffer.from(swaggerPassword, "utf8");
        if (
          passwordBuffer.length === expectedBuffer.length &&
          timingSafeEqual(passwordBuffer, expectedBuffer)
        ) {
          return next();
        }
      }
      res.setHeader("WWW-Authenticate", 'Basic realm="API Docs"');
      return res.status(401).send("Autenticação necessária.");
    });
  }
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
app.use("/api", router);
app.use("/api", (_request, response) => {
  return response.status(404).json({ message: "Rota nao encontrada." });
});

// Serve Expo web static build (quando o build web estiver presente)
const webBuildPath = path.join(__dirname, "..", "public", "app");
const webIndexPath = path.join(webBuildPath, "index.html");
app.use(express.static(webBuildPath));
app.get("*", (_req, res) => {
  if (!fs.existsSync(webIndexPath)) {
    return res.status(404).json({ message: "Rota nao encontrada." });
  }
  res.sendFile(webIndexPath);
});

attachSentryErrorHandler(app);
app.use(errorMiddleware);
