import { File, Paths } from "expo-file-system";
import { communityApi, uploadsApi } from "../services/api/client";

// Mesmo motivo de exportDataFile.ts: os tipos de expo-file-system não
// expõem exists/create/write/uri, que existem de verdade em runtime.
interface WritableFileHandle {
  exists: boolean;
  uri: string;
  delete(): void;
  create(options?: { overwrite?: boolean }): void;
  write(content: string, options?: { encoding?: "utf8" | "base64" }): void;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// A selfie de conclusão fica guardada localmente como data URI (base64).
// Converter isso pra Blob (fetch(dataUri).blob()) e anexar no FormData
// perdia o tipo do arquivo no React Native — o servidor recebia a parte sem
// Content-Type de imagem e recusava com "Formato de mídia inválido". Gravar
// num arquivo de cache e mandar pelo mesmo caminho {uri, name, type} que
// todos os outros uploads do app usam preserva o tipo corretamente.
export async function postSelfieToFeed(
  runWithAuth: <T>(operation: (accessToken: string) => Promise<T>) => Promise<T>,
  selfieDataUri: string,
  caption: string
) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(selfieDataUri);
  if (!match) {
    throw new Error("Não foi possível ler a selfie salva.");
  }
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const base64 = match[2].replace(/\s/g, "");
  const extension = EXTENSION_BY_MIME[mimeType] ?? "jpg";

  const file = new File(Paths.cache, `feed-photo-${Date.now()}.${extension}`) as unknown as WritableFileHandle;
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(base64, { encoding: "base64" });

  try {
    const { url } = await runWithAuth((token) =>
      uploadsApi.uploadMedia(
        token,
        {
          uri: file.uri,
          mimeType,
          fileName: `feed-photo.${extension}`,
          fileSizeBytes: Math.floor(base64.length * 0.75)
        },
        "feed-photos"
      )
    );
    await runWithAuth((token) => communityApi.createPost(token, { imageUrl: url, caption }));
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // limpeza do cache é best effort
    }
  }
}
