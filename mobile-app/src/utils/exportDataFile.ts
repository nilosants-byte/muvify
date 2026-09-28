import { Share } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

// expo-file-system declara FileSystemFile (base de File) como um alias pro
// `File` global do DOM (binding do módulo nativo) - TypeScript não enxerga
// exists/create/write/uri, que existem de verdade em runtime. Interface
// local só com o que este arquivo usa, em vez de depender do subpath
// "/legacy" (que não tem types pré-compilados e, sob tsc puro sem o
// resolver do Metro, acaba resolvendo pro shim web em vez do nativo).
interface WritableFileHandle {
  exists: boolean;
  uri: string;
  delete(): void;
  create(options?: { overwrite?: boolean }): void;
  write(content: string, options?: { encoding?: "utf8" | "base64" }): void;
}

// Base comum: escreve `content` num arquivo de verdade (cache) e abre o
// share sheet nativo com ele — cai no Share.share de texto corrido só se o
// compartilhamento de arquivo não estiver disponível (ex.: web). Extraído
// pra ser reaproveitado por qualquer exportação de texto do app (JSON, CSV,
// etc.), em vez de reimplementar isso a cada nova exportação.
async function shareExportedTextAsFile(
  content: string,
  { filename, mimeType, dialogTitle }: { filename: string; mimeType: string; dialogTitle: string }
) {
  const canShareFile = await Sharing.isAvailableAsync().catch(() => false);

  if (!canShareFile) {
    await Share.share({ message: content, title: dialogTitle });
    return;
  }

  const file = new File(Paths.cache, filename) as unknown as WritableFileHandle;
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(content);

  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle });
}

// Épico de Frentes, Frente 11, Lote 5: exportMyData mandava o JSON inteiro
// como corpo de uma mensagem de texto (Share.share) - vira mensagem de app
// de mensagens em vez de arquivo, e cresce sem limite conforme o export
// ganha mais seções (Lote 5 já quase decuplicou o tamanho). Gera um
// arquivo .json de verdade e abre o share sheet nativo.
export async function shareExportedDataAsFile(data: unknown, dialogTitle = "Meus dados — Muvify") {
  const json = JSON.stringify(data, null, 2);
  await shareExportedTextAsFile(json, {
    filename: `muvify-meus-dados-${Date.now()}.json`,
    mimeType: "application/json",
    dialogTitle
  });
}

// Planilha (.xlsx) gerada pelo servidor e recebida em base64. Diferente do
// JSON/CSV, não tem fallback em texto corrido (Share.share): planilha é
// binário e ilegível como texto - sem compartilhamento de arquivo, falha
// de forma explícita pra a tela mostrar o erro em vez de mandar lixo.
export async function shareBase64FileAsFile(
  base64: string,
  { filename, mimeType, dialogTitle }: { filename: string; mimeType: string; dialogTitle: string }
) {
  const canShareFile = await Sharing.isAvailableAsync().catch(() => false);
  if (!canShareFile) {
    throw new Error("Compartilhamento de arquivo indisponível neste aparelho.");
  }

  const file = new File(Paths.cache, filename) as unknown as WritableFileHandle;
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(base64, { encoding: "base64" });

  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle });
}

// Achado em teste manual: o extrato CSV do financeiro (FinancialHistoryScreen)
// tinha o mesmo problema que o export de dados já teve — ia como texto
// corrido dentro da mensagem do Share.share, ilegível pra quem recebe.
// Mesmo tratamento: vira um arquivo .csv de verdade, abrível em qualquer
// planilha (Excel, Sheets, Numbers).
export async function shareCsvAsFile(csv: string, filenameBase: string, dialogTitle: string) {
  await shareExportedTextAsFile(csv, {
    filename: `${filenameBase}-${Date.now()}.csv`,
    mimeType: "text/csv",
    dialogTitle
  });
}
