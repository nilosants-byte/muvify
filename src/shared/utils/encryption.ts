import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env";

const ENCRYPTION_PREFIX = "enc:v1:";
let warnedWeakKey = false;

function resolveEncryptionSecret() {
  if (env.APP_ENCRYPTION_KEY?.trim()) {
    return env.APP_ENCRYPTION_KEY.trim();
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "APP_ENCRYPTION_KEY nao configurada. Esta variavel e obrigatoria em producao para proteger dados sensiveis."
    );
  }

  if (!warnedWeakKey) {
    warnedWeakKey = true;
    console.warn(
      "[AVISO] APP_ENCRYPTION_KEY nao configurada. Usando JWT_SECRET como fallback APENAS em desenvolvimento."
    );
  }

  return env.JWT_SECRET;
}

function resolveEncryptionKey() {
  return createHash("sha256").update(resolveEncryptionSecret()).digest();
}

function isEncryptedPayload(value: string) {
  return value.startsWith(ENCRYPTION_PREFIX);
}

export function encryptSensitiveText(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  if (isEncryptedPayload(normalized)) {
    return normalized;
  }

  const key = resolveEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${iv.toString("base64url")}.${tag.toString(
    "base64url"
  )}.${ciphertext.toString("base64url")}`;
}

export function decryptSensitiveText(value: string | null | undefined) {
  if (!value) {
    return value ?? null;
  }

  const normalized = value.trim();
  if (!normalized || !isEncryptedPayload(normalized)) {
    return normalized;
  }

  try {
    const payload = normalized.slice(ENCRYPTION_PREFIX.length);
    const [ivEncoded, tagEncoded, dataEncoded] = payload.split(".");
    if (!ivEncoded || !tagEncoded || !dataEncoded) {
      throw new Error("Encrypted payload format invalid");
    }

    const key = resolveEncryptionKey();
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    const encrypted = Buffer.from(dataEncoded, "base64url");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("[encryption] decryptSensitiveText failed:", (err as Error).message);
    return null;
  }
}

