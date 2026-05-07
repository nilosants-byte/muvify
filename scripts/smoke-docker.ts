import { spawnSync } from "child_process";

function run(command: string, args: string[], timeoutMs = 300000) {
  const result = spawnSync(command, args, { stdio: "inherit", timeout: timeoutMs });
  if (result.error) {
    throw result.error;
  }
  if (result.signal === "SIGTERM") {
    throw new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function runStatus(command: string, args: string[], timeoutMs = 15000) {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: timeoutMs });
  if (result.error || result.signal === "SIGTERM") {
    return 1;
  }
  return result.status ?? 1;
}

async function runWithRetry(
  command: string,
  args: string[],
  attempts = 10,
  delayMs = 2000,
  timeoutMs = 60000
) {
  for (let i = 0; i < attempts; i += 1) {
    const result = spawnSync(command, args, { stdio: "inherit", timeout: timeoutMs });
    if (result.error) {
      if (i === attempts - 1) {
        throw result.error;
      }
    } else if (result.signal === "SIGTERM") {
      if (i === attempts - 1) {
        throw new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`);
      }
    } else if (result.status === 0) {
      return;
    } else if (i === attempts - 1) {
      throw new Error(`${command} ${args.join(" ")} failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function waitForHealth(url: string, attempts = 30, delayMs = 2000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Healthcheck failed for ${url}`);
}

async function main() {
  const buildAppImage = process.env.SMOKE_DOCKER_BUILD === "1";
  const appUpTimeoutMs = Number(process.env.SMOKE_DOCKER_APP_UP_TIMEOUT_MS ?? "1800000");
  const healthAttempts = Number(process.env.SMOKE_DOCKER_HEALTH_ATTEMPTS ?? "90");
  const healthDelayMs = Number(process.env.SMOKE_DOCKER_HEALTH_DELAY_MS ?? "2000");

  try {
    run(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.prod.yml",
        "-f",
        "docker-compose.smoke.yml",
        "up",
        "-d",
        "--no-recreate",
        "smoke_postgres",
        "smoke_redis"
      ],
      180000
    );

    for (let i = 0; i < 30; i += 1) {
      const status = runStatus(
        "docker",
        [
          "compose",
          "-f",
          "docker-compose.prod.yml",
          "-f",
          "docker-compose.smoke.yml",
          "exec",
          "-T",
          "smoke_postgres",
          "pg_isready",
          "-U",
          "postgres",
          "-d",
          "personal_app_smoke"
        ],
        15000
      );
      if (status === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (i === 29) {
        throw new Error("Postgres not ready for smoke test.");
      }
    }

    await runWithRetry(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.prod.yml",
        "-f",
        "docker-compose.smoke.yml",
        "exec",
        "-T",
        "smoke_postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "personal_app_smoke",
        "-c",
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
      ],
      10,
      2000,
      30000
    );

    await runWithRetry(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.prod.yml",
        "-f",
        "docker-compose.smoke.yml",
        "exec",
        "-T",
        "smoke_redis",
        "redis-cli",
        "FLUSHALL"
      ],
      10,
      2000,
      30000
    );

    const appUpArgs = [
      "compose",
      "-f",
      "docker-compose.prod.yml",
      "-f",
      "docker-compose.smoke.yml",
      "up",
      "-d",
      "--force-recreate",
      "--no-deps",
    ];
    if (buildAppImage) {
      appUpArgs.push("--build");
    }
    appUpArgs.push("app");

    run("docker", appUpArgs, appUpTimeoutMs);

    await waitForHealth("http://localhost:3000/health", healthAttempts, healthDelayMs);

    const env = { ...process.env, BASE_URL: "http://localhost:3000" };
    const smoke = spawnSync("node", ["scripts/smoke.ts"], {
      stdio: "inherit",
      env,
      timeout: 300000
    });
    if (smoke.error) {
      throw smoke.error;
    }
    if (smoke.signal === "SIGTERM") {
      throw new Error("node scripts/smoke.ts timed out after 300000ms");
    }
    if (smoke.status !== 0) {
      process.exit(smoke.status ?? 1);
    }
  } finally {
    runStatus(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.prod.yml",
        "-f",
        "docker-compose.smoke.yml",
        "down",
        "--remove-orphans"
      ],
      120000
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
