import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export class UnsupportedMediaTypeError extends Error {}
export class InvalidFileContentError extends Error {}

export type UploadFolder =
  | "profile-photos"
  | "presentation-videos"
  | "feed-photos"
  | "cref-documents"
  | "attendance-proofs"
  | "exercise-media";

function validateMagicBytes(buffer: Buffer, mimeType: string): void {
  if (buffer.length < 4) {
    throw new InvalidFileContentError("Arquivo vazio ou corrompido.");
  }
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) {
        throw new InvalidFileContentError("Conteúdo não é uma imagem JPEG válida.");
      }
      break;
    case "image/png":
      if (!(buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)) {
        throw new InvalidFileContentError("Conteúdo não é uma imagem PNG válida.");
      }
      break;
    case "image/webp":
      if (!(buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50)) {
        throw new InvalidFileContentError("Conteúdo não é uma imagem WebP válida.");
      }
      break;
    case "image/gif":
      if (!(buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46)) {
        throw new InvalidFileContentError("Conteúdo não é uma imagem GIF válida.");
      }
      break;
    case "video/mp4":
    case "video/quicktime":
    case "video/3gpp":
      // ISO Base Media: "ftyp" box at bytes 4–7
      if (!(buffer.length >= 8 &&
        buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70)) {
        throw new InvalidFileContentError("Conteúdo não é um vídeo MP4/MOV válido.");
      }
      break;
    case "video/webm":
      // EBML header
      if (!(buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)) {
        throw new InvalidFileContentError("Conteúdo não é um vídeo WebM válido.");
      }
      break;
    case "application/pdf":
      if (!(buffer.length >= 5 &&
        buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d)) {
        throw new InvalidFileContentError("Conteúdo não é um PDF válido.");
      }
      break;
  }
}

function assertAllowedMimeType(mimeType: string): void {
  if (!(mimeType in EXTENSION_BY_MIME)) {
    throw new UnsupportedMediaTypeError(
      "Formato de mídia inválido. Use JPEG, PNG, WEBP, GIF, MP4, MOV, WebM, 3GP ou PDF."
    );
  }
}

export async function uploadMediaFromBuffer(
  buffer: Buffer,
  mimeType: string,
  folder: UploadFolder
): Promise<{ url: string; mimeType: string; sizeBytes: number }> {
  assertAllowedMimeType(mimeType);
  validateMagicBytes(buffer, mimeType);
  const config = getR2Config();
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

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: documento de CREF é
// documento de identidade — grava no mesmo bucket, mas nunca constrói uma
// URL pública. Quem quiser exibir o documento precisa passar pela rota
// assinada (cref-document-signature.ts), nunca acessa o objeto direto.
export async function uploadPrivateMediaFromBuffer(
  buffer: Buffer,
  mimeType: string,
  folder: UploadFolder
): Promise<{ key: string; mimeType: string; sizeBytes: number }> {
  assertAllowedMimeType(mimeType);
  validateMagicBytes(buffer, mimeType);
  const config = getR2Config();
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

  return { key, mimeType, sizeBytes: buffer.byteLength };
}

export async function getPrivateMediaBuffer(key: string): Promise<Buffer> {
  const config = getR2Config();
  const result = await getR2Client(config).send(
    new GetObjectCommand({ Bucket: config.bucketName, Key: key })
  );
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) {
    throw new InvalidFileContentError("Objeto não encontrado ou vazio.");
  }
  return Buffer.from(bytes);
}

// Opaque, already-encrypted content (e.g. an attendance-proof selfie run through
// encryptSensitiveText) — stored under its own key, never exposed as a public URL.
// No mime/magic-byte validation here since the body isn't an image anymore, it's ciphertext.
export async function putPrivateObject(key: string, content: string): Promise<void> {
  const config = getR2Config();
  await getR2Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: Buffer.from(content, "utf8"),
      ContentType: "application/octet-stream"
    })
  );
}

// Épico de Frentes, Frente 8, Lote 10: uploadMediaFromBuffer/
// uploadPrivateMediaFromBuffer nunca tiveram uma contraparte de delete -
// excluir um post ou uma conta apagava o registro no banco, mas a mídia
// ficava órfã no bucket pra sempre (custo/espaço). Best-effort por design:
// quem chama já trata falha (a exclusão do registro no banco não deve
// falhar por causa de um erro de rede no storage).
export async function deleteMediaByUrl(url: string): Promise<void> {
  const config = getR2Config();
  const prefix = `${config.publicUrl.replace(/\/+$/, "")}/`;
  if (!url.startsWith(prefix)) return;
  const key = url.slice(prefix.length);
  await getR2Client(config).send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

// Épico de Frentes, Frente 11, Lote 6: deleteMediaByUrl só sabe apagar
// objetos PÚBLICOS (deriva a key a partir do prefixo publicUrl) - documento
// de CREF e comprovação de presença são objetos PRIVADOS, guardados só pela
// key (ver getPrivateObject/putPrivateObject), sem URL pública nenhuma.
export async function deletePrivateObject(key: string): Promise<void> {
  const config = getR2Config();
  await getR2Client(config).send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

export async function getPrivateObject(key: string): Promise<string> {
  const config = getR2Config();
  const result = await getR2Client(config).send(
    new GetObjectCommand({ Bucket: config.bucketName, Key: key })
  );
  const body = await result.Body?.transformToString("utf8");
  if (body === undefined) {
    throw new InvalidFileContentError("Objeto não encontrado ou vazio.");
  }
  return body;
}
