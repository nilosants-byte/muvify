import "dotenv/config";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { backupDatabase } from "./db-backup";
import { restoreDatabase } from "./db-restore";

export async function resetDatabase() {
  await backupDatabase();
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", { stdio: "inherit" });
  await restoreDatabase();
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  resetDatabase().catch((error) => {
    console.error("db:reset failed:", error);
    process.exit(1);
  });
}
