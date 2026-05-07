import "dotenv/config";
import crypto from "crypto";
import {
  closeSync,
  createReadStream,
  openSync,
  readSync,
  readdirSync,
  statSync
} from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { buildPsqlCommand, getBackupConfig, getDbConfig } from "./db-utils";
import { backupDatabase } from "./db-backup";

function resolveBackupFile(dir: string) {
  const files = readdirSync(dir).filter((entry) => entry.endsWith(".sql.enc")).sort();
  if (files.length === 0) {
    throw new Error("Nenhum backup encontrado.");
  }
  const argIndex = process.argv.indexOf("--file");
  if (argIndex > -1 && process.argv[argIndex + 1]) {
    return join(dir, process.argv[argIndex + 1]);
  }
  return join(dir, files[files.length - 1]);
}

export async function restoreDatabase() {
  const backupBeforeRestore = (process.env.DB_BACKUP_BEFORE_RESTORE || "true").toLowerCase() !== "false";
  if (backupBeforeRestore) {
    console.log("Criando backup antes do restore...");
    await backupDatabase();
  }

  const db = getDbConfig();
  const backup = getBackupConfig();

  const filePath = resolveBackupFile(backup.dir);
  const stats = statSync(filePath);

  const fd = openSync(filePath, "r");
  const headerBuffer = Buffer.alloc(4096);
  const bytesRead = readSync(fd, headerBuffer, 0, headerBuffer.length, 0);
  const headerText = headerBuffer.slice(0, bytesRead).toString("utf8");
  const newlineIndex = headerText.indexOf("\n");
  if (newlineIndex === -1) {
    throw new Error("Header do backup invalido.");
  }
  const header = JSON.parse(headerText.slice(0, newlineIndex)) as { iv: string };
  const iv = Buffer.from(header.iv, "base64");

  const tag = Buffer.alloc(16);
  readSync(fd, tag, 0, 16, stats.size - 16);
  closeSync(fd);

  const cipherStart = newlineIndex + 1;
  const cipherEnd = stats.size - 16 - 1;

  const decipher = crypto.createDecipheriv("aes-256-gcm", backup.key, iv);
  decipher.setAuthTag(tag);

  const { cmd, args, env } = buildPsqlCommand(db, backup);
  const child = spawn(cmd, args, { env });
  child.stderr.pipe(process.stderr);

  const stream = createReadStream(filePath, { start: cipherStart, end: cipherEnd });
  stream.pipe(decipher).pipe(child.stdin);

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`psql failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });

  console.log(`Backup restaurado de ${filePath}`);
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  restoreDatabase().catch((error) => {
    console.error("db:restore failed:", error);
    process.exit(1);
  });
}
