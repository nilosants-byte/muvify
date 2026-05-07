import "dotenv/config";
import { createReadStream, readdirSync, statSync } from "fs";
import { basename, join } from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getBackupConfig, getBackupOffsiteConfig } from "./db-utils";

function resolveLatestBackup(dir: string) {
  const files = readdirSync(dir)
    .filter((entry) => entry.endsWith(".sql.enc"))
    .map((entry) => ({ entry, stats: statSync(join(dir, entry)) }))
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  if (files.length === 0) {
    throw new Error("Nenhum backup encontrado para upload.");
  }
  return join(dir, files[0].entry);
}

export async function uploadLatestBackup() {
  const backup = getBackupConfig();
  const offsite = getBackupOffsiteConfig();
  if (offsite.provider === "none") {
    console.log("Backup offsite desabilitado.");
    return;
  }

  const filePath = resolveLatestBackup(backup.dir);
  const fileName = basename(filePath);
  const keyPrefix = offsite.s3Prefix ? offsite.s3Prefix.replace(/\/+$/, "") : "backups";
  const key = `${keyPrefix}/${fileName}`;

  const client = new S3Client({ region: offsite.s3Region });
  const body = createReadStream(filePath);

  await client.send(
    new PutObjectCommand({
      Bucket: offsite.s3Bucket,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
      ServerSideEncryption: "AES256"
    })
  );

  console.log(`Backup enviado para s3://${offsite.s3Bucket}/${key}`);
}

if (process.argv[1] && process.argv[1].endsWith("db-backup-upload.ts")) {
  uploadLatestBackup().catch((error) => {
    console.error("db:backup:upload failed:", error);
    process.exit(1);
  });
}
