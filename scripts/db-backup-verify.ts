import "dotenv/config";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { buildPsqlCommand, getBackupConfig, getDbConfig } from "./db-utils";
import { restoreDatabase } from "./db-restore";

async function resetSchema() {
  const db = getDbConfig();
  const backup = getBackupConfig();
  const { cmd, args, env } = buildPsqlCommand(db, backup);
  const child = spawn(cmd, args, { env });
  child.stderr.pipe(process.stderr);
  child.stdin.write("DROP SCHEMA public CASCADE; CREATE SCHEMA public;\n");
  child.stdin.end();
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
}

export async function verifyBackupRestore() {
  const verifyUrl = process.env.BACKUP_VERIFY_DATABASE_URL;
  if (!verifyUrl) {
    throw new Error("BACKUP_VERIFY_DATABASE_URL nao definido.");
  }
  process.env.DATABASE_URL = verifyUrl;

  await resetSchema();
  await restoreDatabase();
  console.log("Backup restaurado com sucesso no banco de verificacao.");
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  verifyBackupRestore().catch((error) => {
    console.error("db:backup:verify failed:", error);
    process.exit(1);
  });
}
