import "dotenv/config";
import crypto from "crypto";
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import {
  buildPgDumpCommand,
  getBackupConfig,
  getBackupOffsiteConfig,
  getDbConfig
} from "./db-utils";
import { uploadLatestBackup } from "./db-backup-upload";

export async function backupDatabase() {
  const db = getDbConfig();
  const backup = getBackupConfig();

  mkdirSync(backup.dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(backup.dir, `backup-${timestamp}.sql.enc`);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", backup.key, iv);

  const out = createWriteStream(filePath, { flags: "w" });
  out.write(JSON.stringify({ v: 1, algo: "aes-256-gcm", iv: iv.toString("base64") }) + "\n");

  const { cmd, args, env } = buildPgDumpCommand(db, backup);
  const child = spawn(cmd, args, { env });

  child.stderr.pipe(process.stderr);

  child.stdout.pipe(cipher).pipe(out, { end: false });

  const finished = new Promise<void>((resolve, reject) => {
    let exited = false;
    let closed = false;

    const maybeResolve = () => {
      if (exited && closed) {
        resolve();
      }
    };

    child.on("error", reject);
    out.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pg_dump failed with code ${code}`));
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

  const retentionMs = backup.retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const entry of readdirSync(backup.dir)) {
    if (!entry.endsWith(".sql.enc")) {
      continue;
    }
    const fullPath = join(backup.dir, entry);
    const stats = statSync(fullPath);
    if (now - stats.mtimeMs > retentionMs) {
      unlinkSync(fullPath);
    }
  }

  console.log(`Backup criado em ${filePath}`);

  const offsite = getBackupOffsiteConfig();
  if (offsite.provider !== "none") {
    await uploadLatestBackup();
  }
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  backupDatabase().catch((error) => {
    console.error("db:backup failed:", error);
    process.exit(1);
  });
}
