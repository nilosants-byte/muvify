import { spawnSync } from "child_process";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function runStatus(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status ?? 1;
}

async function runWithRetry(
  command: string,
  args: string[],
  attempts = 10,
  delayMs = 2000
) {
  for (let i = 0; i < attempts; i += 1) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.status === 0) {
      return;
    }
    if (i === attempts - 1) {
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

async function waitForPostgres() {
  for (let i = 0; i < 30; i += 1) {
    const status = runStatus("docker", [
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
    ]);
    if (status === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Postgres not ready for load test.");
}

async function main() {
  try {
    run("docker", [
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
    ]);
    await waitForPostgres();
    await runWithRetry("docker", [
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
    ]);
    run("docker", [
      "compose",
      "-f",
      "docker-compose.prod.yml",
      "-f",
      "docker-compose.smoke.yml",
      "up",
      "-d",
      "--build",
      "--no-deps",
      "app"
    ]);
    await waitForHealth("http://localhost:3000/health");
    const env = { ...process.env, BASE_URL: "http://localhost:3000" };
    const load = spawnSync("node", ["scripts/load-test.cjs"], { stdio: "inherit", env });
    if (load.status !== 0) {
      process.exit(load.status ?? 1);
    }
  } finally {
    runStatus("docker", [
      "compose",
      "-f",
      "docker-compose.prod.yml",
      "-f",
      "docker-compose.smoke.yml",
      "down",
      "--remove-orphans"
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
