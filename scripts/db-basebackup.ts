import "dotenv/config";
import crypto from "crypto";
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { getBackupConfig, getDbConfig } from "./db-utils";

// Base backup fisico (pg_basebackup), combinado com o WAL continuo
// (docker-compose.yml) - juntos permitem restaurar o banco pra qualquer
// segundo antes de um incidente, nao so o ultimo pg_dump. Cadencia semanal
// (rodar via Tarefa Agendada separada) - o pg_dump a cada 2h ja cobre o
// caso comum de "restaurar rapido"; isso aqui cobre "restaurar exatamente
// no instante certo".
export async function backupDatabaseBase() {
  const db = getDbConfig();
  const backup = getBackupConfig();
  const baseDir = join(backup.dir, "base");
  mkdirSync(baseDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(baseDir, `basebackup-${timestamp}.tar.gz.enc`);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", backup.key, iv);

  const out = createWriteStream(filePath, { flags: "w" });
  out.write(JSON.stringify({ v: 1, algo: "aes-256-gcm", iv: iv.toString("base64") }) + "\n");

  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      `PGPASSWORD=${db.password}`,
      backup.container,
      "pg_basebackup",
      "-U",
      db.user,
      "-D",
      "-",
      "-Ft",
      "-z",
      "-Xnone",
      "-c",
      "fast"
    ],
    { env: process.env }
  );
  child.stderr.pipe(process.stderr);
  child.stdout.pipe(cipher).pipe(out, { end: false });

  const finished = new Promise<void>((resolve, reject) => {
    let exited = false;
    let closed = false;
    const maybeResolve = () => {
      if (exited && closed) resolve();
    };
    child.on("error", reject);
    out.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pg_basebackup failed with code ${code}`));
        return;
      }
      exited = true;
      maybeResolve();
    });
    out.on("finish", () => {
      closed = true;
      maybeResolve();
    });
  });

  child.stdout.on("end", () => {
    const tag = cipher.getAuthTag();
    out.write(tag);
    out.end();
  });

  try {
    await finished;
  } catch (error) {
    try {
      out.close();
    } catch {}
    try {
      unlinkSync(filePath);
    } catch {}
    throw error;
  }

  // Retencao mais longa que o pg_dump (base backups sao o ponto de partida
  // pro replay de WAL - perder o unico base backup recente inutiliza o
  // arquivo de WAL acumulado ate aqui).
  const retentionDays = Number(process.env.BACKUP_BASE_RETENTION_DAYS || "30");
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const entry of readdirSync(baseDir)) {
    if (!entry.endsWith(".tar.gz.enc")) continue;
    const fullPath = join(baseDir, entry);
    if (now - statSync(fullPath).mtimeMs > retentionMs) {
      unlinkSync(fullPath);
    }
  }

  console.log(`Base backup criado em ${filePath}`);

  // WAL so serve pra replay a partir de um base backup existente - sem
  // motivo pra guardar WAL mais velho que o base backup mais antigo retido.
  const walDir = resolve(process.env.WAL_ARCHIVE_DIR || "backups/wal");
  try {
    for (const entry of readdirSync(walDir)) {
      const fullPath = join(walDir, entry);
      if (now - statSync(fullPath).mtimeMs > retentionMs) {
        unlinkSync(fullPath);
      }
    }
  } catch {
    // pasta de WAL pode nao existir ainda em ambientes sem archive_mode ligado
  }
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  backupDatabaseBase().catch((error) => {
    console.error("db:basebackup failed:", error);
    process.exit(1);
  });
}
