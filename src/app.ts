import "express-async-errors";
import compression from "compression";
import cors from "cors";
import { randomUUID } from "crypto";
import express from "express";
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
import { sentryErrorHandler, sentryRequestHandler } from "./config/sentry";
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
app.use(sentryRequestHandler);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'"],
      scriptSrc: ["'none'"],
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
        if (password === swaggerPassword) {
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

// Serve Expo web static build
const webBuildPath = path.join(__dirname, "..", "public", "app");
app.use(express.static(webBuildPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webBuildPath, "index.html"));
});

app.use(sentryErrorHandler);
app.use(errorMiddleware);
