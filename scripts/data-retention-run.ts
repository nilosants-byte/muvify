import "dotenv/config";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { DataRetentionService } from "../src/modules/privacy/services/data-retention.service";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function getOption(prefix: string, fallback: string) {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  if (!match) {
    return fallback;
  }
  return match.slice(prefix.length + 1).trim() || fallback;
}

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply;
  const triggeredBy = getOption("--triggered-by", apply ? "MANUAL_APPLY" : "MANUAL_DRY_RUN");

  const service = new DataRetentionService();
  await prisma.$connect();
  try {
    const result = await service.run({
      dryRun,
      triggeredBy,
      legalHoldUserIds: env.DATA_RETENTION_LEGAL_HOLD_USER_IDS.split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("data-retention run failed:", error);
  process.exit(1);
});
