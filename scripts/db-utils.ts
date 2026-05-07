import { resolve } from "path";

export type DbConfig = {
  url: string;
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
};

export type BackupConfig = {
  dir: string;
  retentionDays: number;
  key: Buffer;
  mode: "local" | "docker";
  container: string;
  pgDumpBin: string;
  psqlBin: string;
};

export type BackupOffsiteConfig = {
  provider: "none" | "s3";
  s3Bucket?: string;
  s3Prefix?: string;
  s3Region?: string;
};

export function getDbConfig(): DbConfig {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL nao definido.");
  }
  const url = new URL(rawUrl);
  const database = url.pathname.replace(/^\//, "");
  return {
    url: rawUrl,
    user: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    host: url.hostname,
    port: url.port || "5432",
    database
  };
}

export function getBackupConfig(): BackupConfig {
  const keyBase64 = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error("BACKUP_ENCRYPTION_KEY nao definido.");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY deve ter 32 bytes em base64.");
  }

  const dir = resolve(process.env.BACKUP_DIR || "backups");
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || "7");
  const mode = (process.env.DB_BACKUP_MODE || "docker") as "local" | "docker";
  const container = process.env.DB_BACKUP_CONTAINER || "marketplace_postgres";
  const pgDumpBin = process.env.PG_DUMP_BIN || "pg_dump";
  const psqlBin = process.env.PSQL_BIN || "psql";

  return {
    dir,
    retentionDays: Number.isNaN(retentionDays) ? 7 : retentionDays,
    key,
    mode,
    container,
    pgDumpBin,
    psqlBin
  };
}

export function getBackupOffsiteConfig(): BackupOffsiteConfig {
  const provider = (process.env.BACKUP_OFFSITE_PROVIDER || "none") as "none" | "s3";
  if (provider !== "s3") {
    return { provider: "none" };
  }
  const s3Bucket = process.env.BACKUP_S3_BUCKET;
  if (!s3Bucket) {
    throw new Error("BACKUP_S3_BUCKET nao definido.");
  }
  return {
    provider,
    s3Bucket,
    s3Prefix: process.env.BACKUP_S3_PREFIX || "backups",
    s3Region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
  };
}

export function buildPgDumpCommand(db: DbConfig, backup: BackupConfig) {
  if (backup.mode === "docker") {
    if (!db.user || !db.database) {
      throw new Error("DATABASE_URL precisa conter usuario e database para modo docker.");
    }
    return {
      cmd: "docker",
      args: [
        "exec",
        "-i",
        "-e",
        `PGPASSWORD=${db.password}`,
        backup.container,
        "pg_dump",
        "-U",
        db.user,
        "-d",
        db.database,
        "--no-owner",
        "--no-privileges"
      ] as string[],
      env: process.env
    };
  }

  return {
    cmd: backup.pgDumpBin,
    args: ["--no-owner", "--no-privileges", "--dbname", db.url],
    env: { ...process.env, PGPASSWORD: db.password }
  };
}

export function buildPsqlCommand(db: DbConfig, backup: BackupConfig) {
  if (backup.mode === "docker") {
    if (!db.user || !db.database) {
      throw new Error("DATABASE_URL precisa conter usuario e database para modo docker.");
    }
    return {
      cmd: "docker",
      args: [
        "exec",
        "-i",
        "-e",
        `PGPASSWORD=${db.password}`,
        backup.container,
        "psql",
        "-U",
        db.user,
        "-d",
        db.database
      ] as string[],
      env: process.env
    };
  }

  return {
    cmd: backup.psqlBin,
    args: ["--dbname", db.url],
    env: { ...process.env, PGPASSWORD: db.password }
  };
}
