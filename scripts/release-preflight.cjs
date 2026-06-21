#!/usr/bin/env node
/* eslint-disable no-console */
require("dotenv").config();

const nodemailer = require("nodemailer");
const Redis = require("ioredis");
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);

function getArgValue(flag) {
  const prefixed = `${flag}=`;
  const match = args.find((arg) => arg.startsWith(prefixed));
  return match ? match.slice(prefixed.length) : undefined;
}

function hasFlag(flag) {
  return args.includes(flag);
}

function parseBoolean(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

const targetEnv = getArgValue("--target") || process.env.NODE_ENV || "development";
const strictMode = hasFlag("--strict");
const skipNetwork =
  hasFlag("--skip-network") || parseBoolean(process.env.RELEASE_PREFLIGHT_SKIP_NETWORK, false);

const results = [];

function addResult(status, check, detail) {
  results.push({ status, check, detail });
}

function ok(check, detail) {
  addResult("ok", check, detail);
}

function warn(check, detail) {
  addResult("warn", check, detail);
}

function error(check, detail) {
  addResult("error", check, detail);
}

function isSmtpConfigured() {
  return (
    Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim()) &&
    Boolean(process.env.SMTP_PORT && String(process.env.SMTP_PORT).trim()) &&
    Boolean(process.env.SMTP_USER && process.env.SMTP_USER.trim()) &&
    Boolean(process.env.SMTP_PASS && process.env.SMTP_PASS.trim()) &&
    Boolean(process.env.SMTP_FROM && process.env.SMTP_FROM.trim())
  );
}

function buildSmtpTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: parseBoolean(process.env.SMTP_SECURE, false),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: parseBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true)
    },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 10000
  });
}

function printSummary() {
  const statusSymbol = {
    ok: "[OK]",
    warn: "[WARN]",
    error: "[ERROR]"
  };

  console.log("=== Release Preflight ===");
  console.log(`Target: ${targetEnv}`);
  console.log(`Strict mode: ${strictMode ? "enabled" : "disabled"}`);
  console.log(`Network checks: ${skipNetwork ? "skipped" : "enabled"}`);
  console.log("");

  for (const result of results) {
    console.log(`${statusSymbol[result.status]} ${result.check} - ${result.detail}`);
  }

  const totalErrors = results.filter((item) => item.status === "error").length;
  const totalWarnings = results.filter((item) => item.status === "warn").length;

  console.log("");
  console.log(`Errors: ${totalErrors} | Warnings: ${totalWarnings}`);

  const failed = totalErrors > 0 || (strictMode && totalWarnings > 0);
  if (failed) {
    console.log(
      strictMode && totalWarnings > 0 && totalErrors === 0
        ? "Result: FAILED (strict mode blocked warnings)."
        : "Result: FAILED."
    );
    process.exitCode = 1;
    return;
  }

  console.log("Result: PASSED.");
}

async function main() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(nodeMajor) && nodeMajor >= 20) {
    ok("Node version", `Node.js ${process.versions.node}`);
  } else {
    error("Node version", `Node.js ${process.versions.node} is below required major 20.`);
  }

  if (targetEnv === "production" && process.env.NODE_ENV !== "production") {
    warn("NODE_ENV", `Expected NODE_ENV=production but found "${process.env.NODE_ENV || "undefined"}".`);
  } else {
    ok("NODE_ENV", `Current value: ${process.env.NODE_ENV || "undefined"}`);
  }

  const strictRedisByConfig = parseBoolean(
    process.env.AUTH_REQUIRE_REDIS_FOR_BLACKLIST,
    targetEnv === "production"
  );
  if (strictRedisByConfig) {
    ok("AUTH_REQUIRE_REDIS_FOR_BLACKLIST", "Enabled.");
  } else if (targetEnv === "production") {
    error("AUTH_REQUIRE_REDIS_FOR_BLACKLIST", "Disabled in production target.");
  } else {
    ok("AUTH_REQUIRE_REDIS_FOR_BLACKLIST", "Disabled for non-production target.");
  }

  const smtpVerifyOnStartup = parseBoolean(
    process.env.SMTP_VERIFY_ON_STARTUP,
    targetEnv === "production"
  );
  if (smtpVerifyOnStartup) {
    ok("SMTP_VERIFY_ON_STARTUP", "Enabled.");
  } else if (targetEnv === "production") {
    error("SMTP_VERIFY_ON_STARTUP", "Disabled in production target.");
  } else {
    ok("SMTP_VERIFY_ON_STARTUP", "Disabled for non-production target.");
  }

  const runEmailRetryJob = parseBoolean(process.env.RUN_EMAIL_RETRY_JOB, true);
  if (runEmailRetryJob) {
    ok("RUN_EMAIL_RETRY_JOB", "Enabled.");
  } else {
    warn("RUN_EMAIL_RETRY_JOB", "Disabled. Failed e-mails will not be retried automatically.");
  }

  if (targetEnv === "production" && (process.env.CORS_ORIGIN || "").includes("localhost")) {
    warn("CORS_ORIGIN", "Contains localhost in production target.");
  } else {
    ok("CORS_ORIGIN", process.env.CORS_ORIGIN ? "Configured." : "Not set.");
  }

  if (skipNetwork) {
    ok("Network checks", "Skipped by flag/env.");
    printSummary();
    return;
  }

  const prisma = new PrismaClient();
  let redisClient = null;

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    ok("Database connectivity", "Connected and responded to SELECT 1.");
  } catch (dbError) {
    error("Database connectivity", `Failed: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
  } finally {
    try {
      await prisma.$disconnect();
    } catch {
      // no-op
    }
  }

  try {
    redisClient = new Redis(process.env.REDIS_URL || "", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000
    });
    await redisClient.connect();
    await redisClient.ping();
    ok("Redis connectivity", "Connected and responded to PING.");
  } catch (redisError) {
    const message = redisError instanceof Error ? redisError.message : String(redisError);
    if (strictRedisByConfig) {
      error("Redis connectivity", `Failed in strict mode: ${message}`);
    } else {
      warn("Redis connectivity", `Failed (fallback mode): ${message}`);
    }
  } finally {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch {
        try {
          redisClient.disconnect();
        } catch {
          // no-op
        }
      }
    }
  }

  const smtpConfigured = isSmtpConfigured();
  if (!smtpConfigured) {
    if (targetEnv === "production") {
      error("SMTP configuration", "Missing required SMTP envs.");
    } else {
      warn("SMTP configuration", "Not fully configured.");
    }
  } else {
    ok("SMTP configuration", "All required SMTP envs are present.");
  }

  if (smtpConfigured && smtpVerifyOnStartup) {
    try {
      const transporter = buildSmtpTransport();
      await transporter.verify();
      ok("SMTP connectivity", "Transport verified successfully.");
      transporter.close();
    } catch (smtpError) {
      const message = smtpError instanceof Error ? smtpError.message : String(smtpError);
      if (targetEnv === "production") {
        error("SMTP connectivity", `Verification failed: ${message}`);
      } else {
        warn("SMTP connectivity", `Verification failed: ${message}`);
      }
    }
  }

  printSummary();
}

main().catch((unexpectedError) => {
  console.error(
    "[ERROR] release-preflight crashed:",
    unexpectedError instanceof Error ? unexpectedError.stack || unexpectedError.message : String(unexpectedError)
  );
  process.exitCode = 1;
});
