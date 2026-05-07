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
  attempts = 30,
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

async function waitForPostgres() {
  for (let i = 0; i < 60; i += 1) {
    const status = runStatus("docker", [
      "compose",
      "-f",
      "docker-compose.test.yml",
      "exec",
      "-T",
      "test_postgres",
      "pg_isready",
      "-U",
      "postgres",
      "-d",
      "postgres"
    ]);
    if (status === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Postgres not ready for tests.");
}

async function main() {
  try {
    await runWithRetry("docker", [
      "compose",
      "-f",
      "docker-compose.test.yml",
      "up",
      "-d",
      "--no-recreate",
      "test_postgres",
      "test_redis"
    ]);
    await waitForPostgres();
    runStatus("docker", [
      "compose",
      "-f",
      "docker-compose.test.yml",
      "exec",
      "-T",
      "test_postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      "CREATE DATABASE personal_app_test;"
    ]);
    await runWithRetry("docker", [
      "compose",
      "-f",
      "docker-compose.test.yml",
      "exec",
      "-T",
      "test_postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "personal_app_test",
      "-c",
      "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
    ]);
    run("docker", [
      "compose",
      "-f",
      "docker-compose.test.yml",
      "run",
      "--rm",
      "--no-deps",
      "test"
    ]);
  } finally {
    runStatus("docker", [
      "compose",
      "-f",
      "docker-compose.test.yml",
      "exec",
      "-T",
      "test_postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      "DROP DATABASE IF EXISTS personal_app_test;"
    ]);
    runStatus("docker", [
      "compose",
      "-f",
      "docker-compose.test.yml",
      "down",
      "--remove-orphans"
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
