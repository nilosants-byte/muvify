import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { shareExportedDataAsFile } from "../utils/exportDataFile";

// Épico de Frentes, Frente 11, Lote 5: exportMyData mandava o JSON inteiro
// como corpo de uma mensagem de texto (Share.share) - vira mensagem de app
// de mensagens em vez de arquivo. shareExportedDataAsFile passa a gerar um
// arquivo .json de verdade e abrir o share sheet nativo.
const mockFileInstance = {
  exists: false,
  uri: "file:///cache/muvify-meus-dados-123.json",
  delete: jest.fn(),
  create: jest.fn(),
  write: jest.fn()
};

const mockShareFn = jest.fn();

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => mockFileInstance),
  Paths: { cache: "mock-cache-dir" }
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn()
}));

jest.mock("react-native", () => {
  // Não espalhar (`{...actual}`) - isso lê TODAS as propriedades do módulo,
  // incluindo getters lazy (DevMenu, FlatList, etc.) que quebram fora do
  // binário nativo. Share é definido via getter (sem setter) no index.js
  // do react-native, então uma atribuição direta (`actual.Share = ...`)
  // é silenciosamente ignorada - precisa de defineProperty.
  const actual = jest.requireActual("react-native");
  Object.defineProperty(actual, "Share", {
    configurable: true,
    get: () => ({ share: mockShareFn })
  });
  return actual;
});

describe("shareExportedDataAsFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileInstance.exists = false;
  });

  it("quando compartilhamento de arquivo está disponível, escreve o arquivo e abre o share sheet nativo", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);

    await shareExportedDataAsFile({ hello: "world" });

    expect(File).toHaveBeenCalled();
    expect(mockFileInstance.create).toHaveBeenCalledTimes(1);
    expect(mockFileInstance.write).toHaveBeenCalledWith(JSON.stringify({ hello: "world" }, null, 2));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      mockFileInstance.uri,
      expect.objectContaining({ mimeType: "application/json" })
    );
    expect(mockShareFn).not.toHaveBeenCalled();
  });

  it("apaga o arquivo anterior antes de recriar, se já existir", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    mockFileInstance.exists = true;

    await shareExportedDataAsFile({ hello: "world" });

    expect(mockFileInstance.delete).toHaveBeenCalledTimes(1);
    expect(mockFileInstance.create).toHaveBeenCalledTimes(1);
  });

  it("quando compartilhamento de arquivo não está disponível (ex.: web), cai no Share.share com o texto", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);

    await shareExportedDataAsFile({ hello: "world" });

    expect(mockShareFn).toHaveBeenCalledWith(
      expect.objectContaining({ message: JSON.stringify({ hello: "world" }, null, 2) })
    );
    expect(mockFileInstance.write).not.toHaveBeenCalled();
  });
});
