import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { env } from "../../config/env";

function getR2Config() {
  if (
    !env.R2_ENDPOINT ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_BUCKET_NAME ||
    !env.R2_PUBLIC_URL
  ) {
    throw new Error(
      "R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_URL precisam estar configurados."
    );
  }
  return {
    endpoint: env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_NAME,
    publicUrl: env.R2_PUBLIC_URL
  };
}

let cachedClient: S3Client | undefined;

function getR2Client(config: ReturnType<typeof getR2Config>): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }
  return cachedClient;
}

const DATA_URI_REGEX = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "application/pdf": "pdf"
};

export class InvalidDataUriError extends Error {}

function parseDataUri(dataUri: string): { mimeType: string; buffer: Buffer } {
  const match = DATA_URI_REGEX.exec(dataUri);
  if (!match) {
    throw new InvalidDataUriError("Formato de mídia inválido. Esperado um data URI base64.");
  }
  const [, mimeType, base64] = match;
  return { mimeType, buffer: Buffer.from(base64, "base64") };
}

export async function uploadMediaFromDataUri(
  dataUri: string,
  folder: "profile-photos" | "presentation-videos" | "feed-photos" | "cref-documents" | "attendance-proofs" | "exercise-media"
): Promise<{ url: string; mimeType: string; sizeBytes: number }> {
  const config = getR2Config();
  const { mimeType, buffer } = parseDataUri(dataUri);
  const extension = EXTENSION_BY_MIME[mimeType] ?? "bin";
  const key = `${folder}/${randomUUID()}.${extension}`;

  await getR2Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: buffer,
      ContentType: mimeType
    })
  );

  return {
    url: `${config.publicUrl.replace(/\/+$/, "")}/${key}`,
    mimeType,
    sizeBytes: buffer.byteLength
  };
}
