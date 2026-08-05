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
  write(content: string): void;
}

// Épico de Frentes, Frente 11, Lote 5: exportMyData mandava o JSON inteiro
// como corpo de uma mensagem de texto (Share.share) - vira mensagem de app
// de mensagens em vez de arquivo, e cresce sem limite conforme o export
// ganha mais seções (Lote 5 já quase decuplicou o tamanho). Gera um
// arquivo .json de verdade e abre o share sheet nativo; cai no
// comportamento antigo (texto) só se o compartilhamento de arquivo não
// estiver disponível (ex.: web).
export async function shareExportedDataAsFile(data: unknown, dialogTitle = "Meus dados — Muvify") {
  const canShareFile = await Sharing.isAvailableAsync().catch(() => false);
  const json = JSON.stringify(data, null, 2);

  if (!canShareFile) {
    await Share.share({ message: json, title: dialogTitle });
    return;
  }

  const file = new File(Paths.cache, `muvify-meus-dados-${Date.now()}.json`) as unknown as WritableFileHandle;
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(json);

  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle });
}
