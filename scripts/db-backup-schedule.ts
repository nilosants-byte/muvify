import "dotenv/config";
import { mkdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { backupDatabase } from "./db-backup";
import { getBackupConfig } from "./db-utils";

type LockInfo = {
  pid: number;
  startedAt: string;
  reason: string;
};

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function runBackup(reason: string) {
  const backup = getBackupConfig();
  mkdirSync(backup.dir, { recursive: true });

  if (backup.mode === "docker") {
    await ensureDockerContainerReady(backup.container);
  }

  const lockTimeoutMinutes = parseNumber(process.env.BACKUP_SCHEDULE_LOCK_TIMEOUT_MINUTES, 60);
  const lockTimeoutMs = lockTimeoutMinutes * 60 * 1000;
  const lockPath = join(backup.dir, ".backup.lock");
  const now = Date.now();

  try {
    const stats = statSync(lockPath);
    if (now - stats.mtimeMs < lockTimeoutMs) {
      console.log("Backup ja em execucao, ignorando esta rodada.");
      return;
    }
    unlinkSync(lockPath);
  } catch {}

  const lock: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    reason
  };

  try {
    writeFileSync(lockPath, JSON.stringify(lock), { flag: "wx" });
  } catch {
    console.log("Backup ja em execucao, ignorando esta rodada.");
    return;
  }

  try {
    await backupDatabase();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}

function run(command: string, args: string[]) {
  return spawnSync(command, args, { stdio: "inherit" });
}

function runQuiet(command: string, args: string[]) {
  return spawnSync(command, args, { stdio: "ignore" });
}

async function ensureDockerContainerReady(container: string) {
  const inspect = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", container], {
    stdio: "pipe",
    encoding: "utf8"
  });

  if (inspect.status === 0) {
    if (String(inspect.stdout).trim() === "true") {
      await waitForPostgres(container);
      return;
    }
    run("docker", ["start", container]);
    await waitForPostgres(container);
    return;
  }

  const compose = run("docker", ["compose", "-f", "docker-compose.prod.yml", "up", "-d", "postgres"]);
  if (compose.status !== 0) {
    throw new Error("Falha ao iniciar o container do Postgres para backup.");
  }

  await waitForPostgres(container);
}

async function waitForPostgres(container: string) {
  for (let i = 0; i < 30; i += 1) {
    const status = runQuiet("docker", [
      "exec",
      container,
      "pg_isready",
      "-U",
      "postgres"
    ]);
    if (status.status === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Postgres nao ficou pronto para o backup.");
}

async function main() {
  const intervalMinutes = parseNumber(process.env.BACKUP_SCHEDULE_INTERVAL_MINUTES, 1440);
  const jitterSeconds = parseNumber(process.env.BACKUP_SCHEDULE_JITTER_SECONDS, 60);
  const onStart = (process.env.BACKUP_ON_START || "true").toLowerCase() !== "false";

  if (intervalMinutes <= 0) {
    throw new Error("BACKUP_SCHEDULE_INTERVAL_MINUTES deve ser maior que zero.");
  }

  let stopped = false;
  const intervalMs = intervalMinutes * 60 * 1000;

  const scheduleNext = () => {
    if (stopped) {
      return;
    }
    const jitterMs = Math.max(0, Math.floor(Math.random() * jitterSeconds * 1000));
    setTimeout(async () => {
      if (stopped) {
        return;
      }
      try {
        await runBackup("scheduled");
      } catch (error) {
        console.error("db:backup:schedule failed:", error);
      }
      scheduleNext();
    }, intervalMs + jitterMs);
  };

  if (onStart) {
    await runBackup("startup");
  }

  scheduleNext();

  const shutdown = () => {
    stopped = true;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((error) => {
    console.error("db:backup:schedule failed:", error);
    process.exit(1);
  });
}
